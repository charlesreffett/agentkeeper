# Build your first plugin

## 1. Create the package

Create a directory with this shape:

```text
hello-plugin/
  manifest.json
  package.json
  src/index.ts
  dist/index.js
```

Install `@agentkeeper/sdk` as a development dependency and bundle the backend into a
self-contained ECMAScript module. Runtime imports must resolve inside the final
bundle; AgentKeeper does not install a plugin's npm dependencies.

```json
{
  "name": "hello-agentkeeper-plugin",
  "private": true,
  "type": "module",
  "scripts": { "build": "esbuild src/index.ts --bundle --platform=browser --format=esm --outfile=dist/index.js" },
  "devDependencies": { "@agentkeeper/sdk": "^0.0.1", "esbuild": "^0.27.0" }
}
```

## 2. Declare the manifest

```json manifest
{
  "schema_version": 1,
  "id": "example.hello",
  "name": "Hello provider",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "min_app_version": "0.1.0",
  "activation_events": ["onStartup"],
  "permissions": ["commands"]
}
```

Paths are package-relative and cannot be absolute, contain backslashes, `.` or `..`
segments, or refer outside the plugin directory.

## 3. Activate the backend

```ts compile
import { definePlugin } from '@agentkeeper/sdk'

export default definePlugin({
  activate(ctx) {
    const dispose = ctx.commands.register({
      id: 'example.hello.greet',
      label: 'Say hello',
      handler: async (args) => ({ greeting: `Hello, ${String(args ?? 'world')}` }),
    })
    ctx.events.on('plugin.deactivated', dispose)
  },
})
```

Registration methods return cleanup functions. Retain and call them from the plugin's
deactivation path; do not assume the process will remain active indefinitely.

## 4. Build and load unpacked

Run the package build, enable **Plugin developer mode** in AgentKeeper Settings, and
choose **Load unpacked**. Select the plugin directory, review the manifest and exact
authority, then accept the native confirmation. Developer mode does not weaken the
sandbox. A manifest authority change stops the watcher until the new authority is
reviewed.

Debug backend failures from AgentKeeper's plugin diagnostics and main-process log.
Debug renderer code with the iframe's DevTools context. Rebuild before testing file
changes; the host loads built entries, not TypeScript source.

## 5. Add a renderer

Add a self-contained `dist/renderer.js`, list its view, declare a route, and grant
`ui`. The bundle must create its own DOM beneath `#app` and must not depend on runtime
template compilation, `eval`, a CDN, or unbundled styles.

```json manifest
{
  "schema_version": 1,
  "id": "example.hello-ui",
  "name": "Hello UI",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "permissions": ["commands", "ui"],
  "renderer": { "entry": "dist/renderer.js", "views": ["home"] },
  "contributes": {
    "routes": [{ "id": "home", "path": "home", "view": "home" }],
    "navigation": [{ "id": "hello", "label": "Hello", "route": "home", "order": 100 }],
    "settings": []
  }
}
```

## 6. Package, install, update, and uninstall

From the AgentKeeper repository, the reference packer is:

```bash
pnpm --filter @agentkeeper/cli build
pnpm --filter @agentkeeper/cli exec node dist/cli.cjs pack --dir /absolute/path/to/hello-plugin
```

Install the resulting `.akp` with **Install from AKP** and repeat smoke tests against
the packaged artifact. For updates, publish an HTTPS update manifest containing the
archive URL, SHA-256, version, and minimum app version. Uninstall from Settings and
verify backend cleanup, renderer removal, storage removal, and credential removal.
