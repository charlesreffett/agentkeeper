# `@agentkeeper/sdk`

Public contracts and test helpers for AgentKeeper plugins.

```ts
import { definePlugin, type PluginContext } from '@agentkeeper/sdk'
import { createMockContext } from '@agentkeeper/sdk/testing'
```

Plugin backend builds must bundle any runtime SDK helpers they import. Installed
plugins are self-contained and cannot resolve `@agentkeeper/sdk` from the host.
The sandbox bootstrap and host bridge are owned and supplied by the AgentKeeper
application; they are not part of this package or a plugin's bundle.

SDK releases track the AgentKeeper application contract. A plugin declares the
earliest compatible host with the manifest's existing `min_app_version` field.
Set it to the first AgentKeeper version that supplies every SDK API used by the
plugin. The host enforces that minimum while selecting updates and activating
plugins. There is intentionally no separate SDK compatibility field.
