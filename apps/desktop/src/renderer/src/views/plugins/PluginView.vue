<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PluginRecord, WorkItem } from '@shared/ipc-contract'
import WorkItemSessionModal from './WorkItemSessionModal.vue'
import { useSessionStore } from '@/stores/sessions'

type BridgeRequest = {
  channel: 'agentkeeper-plugin'
  id?: string
  type: 'ready' | 'invoke' | 'navigate' | 'openExternal' | 'startSession' | 'workItemSessions' | 'openSession'
  command?: string
  args?: unknown
  path?: string
  url?: string
  itemId?: string
  projectPath?: string
  sessionId?: string
}

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

function buildDocument(script: string, viewId: string, providerId: string, path: string): string {
  const initial = JSON.stringify({
    pluginId: providerId,
    viewId,
    path,
    colorScheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  }).replaceAll('<', '\\u003c')
  const bridge = `
    (() => {
      const initial = ${initial};
      const pending = new Map();
      const routeListeners = new Set();
      const send = (message) => parent.postMessage({ channel: 'agentkeeper-plugin', ...message }, '*');
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
      });
      addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.channel !== 'agentkeeper-host') return;
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
      send({ type: 'ready' });
    })();
  `
  const bridgeUrl = scriptDataUrl(bridge)
  const pluginUrl = scriptDataUrl(script)
  const scriptClose = '<' + '/script>'
  return `<!doctype html>
<html class="${document.documentElement.classList.contains('dark') ? 'dark' : ''}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data: https:; font-src data:">
  <style>html,body,#app{height:100%;margin:0}body{font:13px system-ui,sans-serif;color:#1f2937;background:#fff}.dark body{color:#e5e7eb;background:#111827}*{box-sizing:border-box}button,input,select,textarea{font:inherit}</style>
</head>
<body><div id="app"></div>
<script src="${bridgeUrl}">${scriptClose}
<script src="${pluginUrl}">${scriptClose}
</body></html>`
}

async function load(): Promise<void> {
  const generation = ++loadGeneration
  const providerId = pluginId.value
  const path = pluginPath.value
  loading.value = true
  unavailable.value = false
  detail.value = ''
  await nextTick()
  try {
    const plugins = await window.agentkeeper.plugins.list()
    if (generation !== loadGeneration) return
    const found = plugins.find((candidate) => candidate.id === providerId && candidate.enabled)
    if (!found) throw new Error('Provider not available')
    plugin.value = found
    const routeContribution = found.manifest.contributes?.routes.find(
      (candidate) => path === candidate.path || path.startsWith(`${candidate.path}/`),
    )
    if (!routeContribution) throw new Error('Provider view not available')
    const bundle = await window.agentkeeper.plugins.getRendererBundle(found.id, routeContribution.view)
    if (generation !== loadGeneration) return
    if (frame.value) frame.value.srcdoc = buildDocument(bundle.script, routeContribution.view, providerId, path)
  } catch (error) {
    if (generation !== loadGeneration) return
    unavailable.value = true
    detail.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function onMessage(event: MessageEvent<BridgeRequest>): Promise<void> {
  if (event.source !== frame.value?.contentWindow) return
  const message = event.data
  if (!message || message.channel !== 'agentkeeper-plugin') return
  if (message.type === 'ready') {
    frame.value?.contentWindow?.postMessage({
      channel: 'agentkeeper-host',
      type: 'route.changed',
      path: pluginPath.value,
    }, '*')
    return
  }
  if (message.type === 'navigate' && message.path) {
    const safePath = message.path.replace(/^\/+/, '')
    await router.push(`/plugin/${encodeURIComponent(pluginId.value)}/${safePath}`)
    return
  }
  if (message.type === 'openExternal' && message.url) {
    const target = new URL(message.url)
    if (!['https:', 'http:'].includes(target.protocol)) return
    window.open(target.href, '_blank')
    return
  }
  if (message.type === 'startSession' && message.itemId) {
    const item = await window.agentkeeper.workItems.get({ sourceId: pluginId.value, itemId: message.itemId })
    if (!item) return
    sessionItem.value = item
    sessionProjectPath.value = message.projectPath ?? ''
    sessionModalOpen.value = true
    return
  }
  if (message.type === 'workItemSessions' && message.id) {
    try {
      const projects = await window.agentkeeper.projects.list()
      const persisted = (await Promise.all([null, ...projects.map(project => project.path)].map(path => window.agentkeeper.sessions.listPersisted(path)))).flat()
      const live = Object.values(sessionStore.sessions)
      const sessions = [...live, ...persisted]
        .filter((session, index, all) => all.findIndex(candidate => candidate.localId === session.localId) === index)
        .filter(session => session.workItem?.sourceId === pluginId.value && (!message.itemId || session.workItem.itemId === message.itemId))
        .map(session => ({ id: session.localId, itemId: session.workItem!.itemId, status: session.status, title: session.title, lastActivityAt: session.lastActivityAt }))
      frame.value?.contentWindow?.postMessage({ channel: 'agentkeeper-host', type: 'response', id: message.id, result: sessions }, '*')
    } catch (error) {
      frame.value?.contentWindow?.postMessage({ channel: 'agentkeeper-host', type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) }, '*')
    }
    return
  }
  if (message.type === 'openSession' && message.sessionId) {
    const session = sessionStore.sessions[message.sessionId] ?? await window.agentkeeper.sessions.getByLocalId(message.sessionId)
    if (session?.workItem?.sourceId === pluginId.value) await router.push(`/sessions/${message.sessionId}`)
    return
  }
  if (message.type === 'invoke' && message.id && message.command) {
    try {
      const result = await window.agentkeeper.plugins.invoke(pluginId.value, message.command, message.args)
      frame.value?.contentWindow?.postMessage({ channel: 'agentkeeper-host', type: 'response', id: message.id, result }, '*')
    } catch (error) {
      frame.value?.contentWindow?.postMessage({
        channel: 'agentkeeper-host',
        type: 'response',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }, '*')
    }
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  void load()
})
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

watch([pluginId, pluginPath], ([nextId], [previousId]) => {
  if (nextId !== previousId) void load()
  else frame.value?.contentWindow?.postMessage({
    channel: 'agentkeeper-host',
    type: 'route.changed',
    path: pluginPath.value,
  }, '*')
})
</script>

<template>
  <div class="h-full min-h-0 bg-background">
    <div v-if="loading" class="h-full grid place-items-center text-sm text-muted-foreground">Loading provider…</div>
    <div v-else-if="unavailable" class="h-full grid place-items-center p-8">
      <div class="max-w-sm text-center">
        <h1 class="text-base font-semibold">Provider not available</h1>
        <p v-if="detail && detail !== 'Provider not available'" class="mt-2 text-sm text-muted-foreground">{{ detail }}</p>
        <button class="mt-4 text-sm text-primary hover:underline" @click="load">Retry</button>
      </div>
    </div>
    <iframe
      :key="pluginId"
      v-show="!loading && !unavailable"
      ref="frame"
      class="block size-full border-0"
      sandbox="allow-scripts"
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
