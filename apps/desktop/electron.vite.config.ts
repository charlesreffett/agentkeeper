import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// Workspace packages ship .ts source (no build step — see their package.json
// "build": "tsc --emitDeclarationOnly"). They must be bundled into the
// main/preload output, NOT externalized, otherwise Node tries to import
// `src/index.ts` at runtime and fails with ERR_UNKNOWN_FILE_EXTENSION.
const WORKSPACE_PKGS = [
  '@agentkeeper/sdk',
  '@agentkeeper/core',
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'plugin-bootstrap': resolve(__dirname, '../../packages/sdk/src/bootstrap.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
