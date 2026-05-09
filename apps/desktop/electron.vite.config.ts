import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { cpSync } from 'node:fs'
import type { Plugin } from 'vite'

function copyDrizzleMigrations(): Plugin {
  return {
    name: 'copy-drizzle-migrations',
    closeBundle() {
      cpSync(
        resolve(__dirname, 'src/main/db/migrations'),
        resolve(__dirname, 'out/main/migrations'),
        { recursive: true },
      )
    },
  }
}

// Workspace packages ship .ts source (no build step — see their package.json
// "build": "tsc --emitDeclarationOnly"). They must be bundled into the
// main/preload output, NOT externalized, otherwise Node tries to import
// `src/index.ts` at runtime and fails with ERR_UNKNOWN_FILE_EXTENSION.
const WORKSPACE_PKGS = [
  '@agentkeeper/sdk',
  '@agentkeeper/core',
  '@agentkeeper/plugin-jira',
  '@agentkeeper/plugin-github',
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS }), copyDrizzleMigrations()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
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
