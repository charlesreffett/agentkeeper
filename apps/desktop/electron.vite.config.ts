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
  'http-proxy-agent',
  'https-proxy-agent',
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'plugin-sandbox': resolve(__dirname, 'src/preload/plugin-sandbox.ts'),
        },
        // Sandboxed Electron preload scripts are loaded by a restricted
        // CommonJS runtime.  Emitting ESM here produces an .mjs file that is
        // parsed as a classic script and fails on its first `import`, leaving
        // the renderer without the contextBridge API.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
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
