# SDK and host APIs

## Activation context

`definePlugin` preserves plugin typing. `activate(ctx)` may be synchronous or async.
Optional lifecycle hooks are `deactivate`, `onInstall`, `onUpdate`, and `onUninstall`.
Lifecycle callbacks are bounded by the host; cleanup must be idempotent.

The context exposes:

- `config`: current validated plugin settings.
- `logger`: debug, info, warning, and error logging.
- `storage`: plugin-scoped JSON values with get, set, delete, and prefix list.
- `secrets`: plugin-scoped get, set, and delete backed by OS credential storage.
- `environment`: read an exact manifest-declared variable.
- `events`: subscribe to typed lifecycle/session/job events and emit allowed events.
- `workItems`: register a `WorkItemProvider` owned by the plugin.
- `ui`: register lifecycle-scoped supplemental typed host-slot data.
- `commands`: register plugin commands with serializable arguments and results.
- `background`: schedule once or periodic bounded work; clean it up on deactivate.
- `projects`: list paths, names, and provider-neutral Git remotes.
- `process`: execute a file only with `nativeProcess`.
- `fetch`: host-brokered HTTP(S), only with `network` and an allowed origin.

## Work-item providers

A provider has an ID and label plus `list` and `get`. It may implement status updates,
comments, transitions, and creation. IDs are provider-owned opaque strings. Persisted
references include `sourceId`, provider `itemId`, external reference, and an offline
title snapshot. Never infer the provider from a human-readable issue key.

Provider calls should return canonical `WorkItemStatus` and may include a display
label and category. When a provider is unavailable, the host retains the snapshot and
presents one provider-unavailable state.

## Commands and serialization

Command arguments, results, storage values, events, and bridge messages cross a
structured-clone/JSON boundary. Use plain objects, arrays, strings, numbers, booleans,
and null. Do not return functions, class instances, DOM nodes, streams, cyclic graphs,
or secrets. Validate unknown command arguments inside the handler.

Errors cross the boundary as messages, not custom prototypes. Use actionable public
messages and log diagnostic context separately. Long work must support host lifecycle
shutdown and avoid leaving stale callbacks after deactivation.

## Cancellation and cleanup

The current v1 command contract has no portable caller-provided abort signal. Bound
network and native-process work with timeouts, check generation tokens before
publishing asynchronous UI results, and retain every returned unsubscribe/dispose
function. A plugin must tolerate deactivation between any two awaited operations.
