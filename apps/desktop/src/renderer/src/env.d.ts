/// <reference types="vite/client" />

import type { AgentKeeperApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    agentkeeper: AgentKeeperApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
