import highlight from '@comark/vue/plugins/highlight'
import type { ThemeRegistration } from 'shiki'
import CodeBlock from '@/components/transcript/CodeBlock.vue'

export const transcriptComponents = {
  pre: CodeBlock,
}

const VALID_TAG = /^[a-zA-Z_][a-zA-Z0-9_\-.:]*/

function sanitizeNodes(nodes: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const node of nodes) {
    if (typeof node === 'string') { out.push(node); continue }
    if (!Array.isArray(node) || node.length < 1) continue
    const tag = node[0]
    if (typeof tag !== 'string' || !VALID_TAG.test(tag)) continue
    out.push([tag, node[1] ?? {}, ...sanitizeNodes(node.slice(2))])
  }
  return out
}

const sanitizeTagsPlugin = {
  name: 'sanitize-tags',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async post(state: any) {
    state.tree = { ...state.tree, nodes: sanitizeNodes(state.tree.nodes) }
  },
}

export const transcriptPlugins = [
  sanitizeTagsPlugin,
  highlight({
    themes: {
      light: 'material-theme-lighter' as ThemeRegistration,
      dark: 'material-theme-palenight' as ThemeRegistration,
    },
  }),
]
