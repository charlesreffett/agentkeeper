/// <reference types="vite/client" />

import type { OrchestralApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    orchestral: OrchestralApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
