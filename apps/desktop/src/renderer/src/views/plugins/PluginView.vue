<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PluginRecord, WorkItem } from '@shared/ipc-contract'
import WorkItemSessionModal from './WorkItemSessionModal.vue'
import { useSessionStore } from '@/stores/sessions'
import {
  PLUGIN_IFRAME_CSP,
  normalizeRequestedExternalUrl,
  parsePluginBridgeRequest,
  resolveDeclaredPluginRoute,
} from './plugin-view-policy'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const frame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const unavailable = ref(false)
const detail = ref('')
const plugin = ref<PluginRecord | null>(null)
const sessionItem = ref<WorkItem | null>(null)
const sessionProjectPath = ref('')
const sessionModalOpen = ref(false)
let loadGeneration = 0
let bridgeToken = crypto.randomUUID()
let loadedViewId = ''
let readyToken = ''
let readyTimer: ReturnType<typeof setTimeout> | null = null
let cleanupPluginEvents: (() => void) | null = null

const pluginId = computed(() => String(route.params.pluginId ?? ''))
const pluginPath = computed(() => {
  const value = route.params.pathMatch
  return Array.isArray(value) ? value.join('/') : String(value ?? '')
})

function scriptDataUrl(source: string): string {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:text/javascript;base64,${btoa(binary)}`
}

function buildDocument(script: string, viewId: string, providerId: string, path: string, token: string): string {
  const initial = JSON.stringify({
    pluginId: providerId,
    viewId,
    path,
    token,
    // data:/file: documents have opaque origins and require a wildcard. In
    // development the parent is HTTP(S), so outbound messages can be scoped.
    hostTargetOrigin: ['http:', 'https:'].includes(window.location.protocol) ? window.location.origin : '*',
    colorScheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  }).replaceAll('<', '\\u003c')
  const bridge = `
    (() => {
      const initial = ${initial};
      const pending = new Map();
      const routeListeners = new Set();
      const send = (message) => parent.postMessage(
        { channel: 'agentkeeper-plugin', token: initial.token, ...message },
        initial.hostTargetOrigin,
      );
      window.agentkeeperPlugin = Object.freeze({
        pluginId: initial.pluginId,
        viewId: initial.viewId,
        getRoute: () => initial.path,
        invoke(command, args) {
          const id = crypto.randomUUID();
          send({ id, type: 'invoke', command, args });
          return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
        navigate(path) { send({ type: 'navigate', path }); },
        openExternal(url) { send({ type: 'openExternal', url }); },
        startSession(itemId, projectPath) { send({ type: 'startSession', itemId, projectPath }); },
        getWorkItemSessions(itemId) {
          const id = crypto.randomUUID();
          send({ id, type: 'workItemSessions', itemId });
          return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
        openSession(sessionId) { send({ type: 'openSession', sessionId }); },
        onRouteChanged(listener) { routeListeners.add(listener); return () => routeListeners.delete(listener); },
        __signalReady() { send({ type: 'ready' }); },
      });
      addEventListener('message', (event) => {
        const message = event.data;
        if (event.source !== parent || !message || message.channel !== 'agentkeeper-host' || message.token !== initial.token) return;
        if (message.type === 'response' && message.id) {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.error) request.reject(new Error(message.error));
          else request.resolve(message.result);
        }
        if (message.type === 'route.changed') {
          initial.path = message.path;
          for (const listener of routeListeners) listener(message.path);
        }
      });
    })();
  `
  // A single data: script preserves execution order. With separate bridge and
  // plugin scripts Chromium can finish the bridge document, emit `ready`, and
  // leave the plugin bundle pending until a later frame navigation.
  const runtimeUrl = scriptDataUrl(`${bridge}\n${script}\nwindow.agentkeeperPlugin.__signalReady();`)
  const scriptClose = '<' + '/script>'
  return `<!doctype html>
<html class="${document.documentElement.classList.contains('dark') ? 'dark' : ''}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${PLUGIN_IFRAME_CSP}">
  <meta http-equiv="x-dns-prefetch-control" content="off">
  <style>html,body,#app{height:100%;margin:0}body{font:13px system-ui,sans-serif;color:#1f2937;background:#fff}.dark body{color:#e5e7eb;background:#111827}*{box-sizing:border-box}button,input,select,textarea{font:inherit}</style>
</head>
<body><div id="app"></div>
<script src="${runtimeUrl}">${scriptClose}
</body></html>`
}

function revokeView(reason = 'Provider not available'): void {
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = null
  loadGeneration += 1
  bridgeToken = crypto.randomUUID()
  readyToken = ''
  loadedViewId = ''
  plugin.value = null
  loading.value = false
  unavailable.value = true
  detail.value = reason
  sessionModalOpen.value = false
  sessionItem.value = null
  if (frame.value) {
    frame.value.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
  }
}

function postToPlugin(message: Record<string, unknown>, token = bridgeToken): void {
  if (token !== bridgeToken) return
  // A sandboxed srcdoc has an opaque origin, so '*' is required in this
  // direction. The unguessable, per-document token and source checks scope it.
  frame.value?.contentWindow?.postMessage({
    channel: 'agentkeeper-host',
    token,
    ...message,
  }, '*')
}

async function load(attempt = 0): Promise<void> {
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = null
  const generation = ++loadGeneration
  const providerId = pluginId.value
  const token = crypto.randomUUID()
  bridgeToken = token
  readyToken = ''
  loadedViewId = ''
  plugin.value = null
  loading.value = true
  unavailable.value = false
  detail.value = ''
  if (frame.value) frame.value.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
  await nextTick()
  try {
    const plugins = await window.agentkeeper.plugins.list()
    if (generation !== loadGeneration || token !== bridgeToken) return
    const found = plugins.find((candidate) => candidate.id === providerId && candidate.enabled)
    if (!found) throw new Error('Provider not available')
    if (!found.manifest.permissions.includes('ui')) throw new Error('Provider does not have UI permission')
    plugin.value = found
    const routeContribution = resolveDeclaredPluginRoute(
      pluginPath.value,
      found.manifest.contributes?.routes ?? [],
    )
    if (!routeContribution) throw new Error('Provider view not available')
    const bundle = await window.agentkeeper.plugins.getRendererBundle(found.id, routeContribution.view)
    if (generation !== loadGeneration || token !== bridgeToken) return
    loadedViewId = routeContribution.view
    if (frame.value) {
      frame.value.srcdoc = buildDocument(bundle.script, routeContribution.view, providerId, routeContribution.path, token)
      readyTimer = setTimeout(() => {
        if (generation !== loadGeneration || token !== bridgeToken || readyToken === token) return
        readyTimer = null
        if (attempt < 2) void load(attempt + 1)
        else {
          loading.value = false
          unavailable.value = true
          detail.value = 'Provider view did not finish loading. Retry to load it again.'
        }
      }, 1_000)
    }
  } catch (error) {
    if (generation !== loadGeneration || token !== bridgeToken) return
    loadedViewId = ''
    plugin.value = null
    unavailable.value = true
    detail.value = error instanceof Error ? error.message : String(error)
  }
}

async function onMessage(event: MessageEvent<unknown>): Promise<void> {
  if (event.source !== frame.value?.contentWindow) return
  // srcdoc without allow-same-origin is intentionally assigned an opaque
  // origin. Source + a rotated capability token authenticate this document.
  if (event.origin !== 'null') return
  const requestToken = bridgeToken
  const message = parsePluginBridgeRequest(event.data, requestToken)
  if (!message) return
  if (message.type === 'ready') {
    readyToken = requestToken
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
    loading.value = false
    postToPlugin({
      type: 'route.changed',
      path: pluginPath.value,
    }, requestToken)
    return
  }
  if (message.type === 'navigate') {
    const declared = resolveDeclaredPluginRoute(message.path, plugin.value?.manifest.contributes?.routes ?? [])
    if (!declared) return
    await router.push(`/plugin/${encodeURIComponent(pluginId.value)}/${declared.path}`)
    return
  }
  if (message.type === 'openExternal') {
    const target = normalizeRequestedExternalUrl(message.url)
    if (!target) return
    // The main process performs the authoritative URL check and asks for an
    // explicit confirmation before passing the URL to the operating system.
    window.open(target, '_blank', 'noopener,noreferrer')
    return
  }
  if (message.type === 'startSession') {
    const item = await window.agentkeeper.workItems.get({ sourceId: pluginId.value, itemId: message.itemId })
    if (!item || requestToken !== bridgeToken) return
    sessionItem.value = item
    sessionProjectPath.value = message.projectPath ?? ''
    sessionModalOpen.value = true
    return
  }
  if (message.type === 'workItemSessions') {
    try {
      const projects = await window.agentkeeper.projects.list()
      const persisted = (await Promise.all([null, ...projects.map(project => project.path)].map(path => window.agentkeeper.sessions.listPersisted(path)))).flat()
      const live = Object.values(sessionStore.sessions)
      const sessions = [...live, ...persisted]
        .filter((session, index, all) => all.findIndex(candidate => candidate.localId === session.localId) === index)
        .filter(session => session.workItem?.sourceId === pluginId.value && (!message.itemId || session.workItem.itemId === message.itemId))
        .map(session => ({ id: session.localId, itemId: session.workItem!.itemId, status: session.status, title: session.title, lastActivityAt: session.lastActivityAt }))
      postToPlugin({ type: 'response', id: message.id, result: sessions }, requestToken)
    } catch (error) {
      postToPlugin({ type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) }, requestToken)
    }
    return
  }
  if (message.type === 'openSession') {
    const session = sessionStore.sessions[message.sessionId] ?? await window.agentkeeper.sessions.getByLocalId(message.sessionId)
    if (requestToken === bridgeToken && session?.workItem?.sourceId === pluginId.value) {
      await router.push(`/sessions/${encodeURIComponent(message.sessionId)}`)
    }
    return
  }
  if (message.type === 'invoke') {
    try {
      const result = await window.agentkeeper.plugins.invoke(pluginId.value, message.command, message.args)
      postToPlugin({ type: 'response', id: message.id, result }, requestToken)
    } catch (error) {
      postToPlugin({
        type: 'response',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }, requestToken)
    }
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  cleanupPluginEvents = window.agentkeeper.plugins.onEvent((event, payload) => {
    const lifecycle = payload as { pluginId?: string }
    if (lifecycle?.pluginId !== pluginId.value) return
    if (event === 'plugin.activated' || event === 'plugin.updated') void load()
    // An unhealthy plugin is still active and its renderer may contain the
    // settings needed to repair authentication. Only tear the capability-
    // scoped frame down when the plugin actually stops being available.
    else if (event === 'plugin.deactivated' || event === 'plugin.uninstalled') {
      revokeView('Provider not available')
    }
  })
  void load()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  cleanupPluginEvents?.()
  cleanupPluginEvents = null
  revokeView()
})

watch([pluginId, pluginPath], ([nextId], [previousId]) => {
  if (nextId !== previousId) void load()
  else {
    const declared = resolveDeclaredPluginRoute(pluginPath.value, plugin.value?.manifest.contributes?.routes ?? [])
    if (!declared) {
      revokeView('Provider view not available')
    } else if (declared.view !== loadedViewId) {
      void load()
    } else {
      postToPlugin({ type: 'route.changed', path: declared.path })
    }
  }
})
</script>

<template>
  <div class="h-full min-h-0 bg-background">
    <div v-if="loading" class="h-full grid place-items-center text-sm text-muted-foreground">Loading provider…</div>
    <div v-else-if="unavailable" class="h-full grid place-items-center p-8">
      <div class="max-w-sm text-center">
        <h1 class="text-base font-semibold">Provider not available</h1>
        <p v-if="detail && detail !== 'Provider not available'" class="mt-2 text-sm text-muted-foreground">{{ detail }}</p>
        <button class="mt-4 text-sm text-primary hover:underline" @click="load()">Retry</button>
      </div>
    </div>
    <iframe
      :key="pluginId"
      v-show="!loading && !unavailable"
      ref="frame"
      class="block size-full border-0"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      allow=""
      title="Plugin view"
    />
    <WorkItemSessionModal
      :open="sessionModalOpen"
      :source-id="pluginId"
      :item="sessionItem"
      :suggested-project-path="sessionProjectPath"
      @close="sessionModalOpen = false"
    />
  </div>
</template>
