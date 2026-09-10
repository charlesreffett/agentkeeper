# Manifest reference

The manifest is strict JSON: unknown fields and malformed values are rejected.

| Field | Required/default | Contract |
| --- | --- | --- |
| `schema_version` | required | Literal `1`. |
| `id` | required | 1–128 NFC characters; lowercase letters, digits, `.`, `_`, `-`; begins and ends alphanumeric. |
| `name` | required | Non-empty display text, at most 2,048 characters, no control characters. |
| `version` | required | Valid semantic version. |
| `entry` | required | Safe package-relative backend bundle path. |
| `icon` | optional | Safe package-relative PNG, JPEG, or WebP path. |
| `description`, `author`, `license` | optional | Display text without control characters. |
| `keywords` | optional | At most 128 display strings. |
| `homepage_url` | optional | URL, at most 2,048 characters. |
| `min_app_version` | optional | Valid semantic version; incompatible plugins do not activate. |
| `activation_events` | `['onStartup']` | At most 64 security identifiers. |
| `permissions` | `[]` | Unique values from the permission table below. |
| `environment.variables` | conditional | Required non-empty uppercase-name list with `environment`; forbidden without it. |
| `network.hosts` | conditional | Required non-empty canonical-origin list with `network`; forbidden without it. |
| `settings_schema` | optional | Strict object schema described below. |
| `renderer` | optional | Safe entry path and 1–128 declared view IDs. Requires `ui`. |
| `contributes` | optional | Strict `routes`, `navigation`, and `settings` arrays. Requires `ui`. |
| `update_url` | optional | HTTPS URL to an update manifest. |

## Permissions

| Permission | Capability |
| --- | --- |
| `workItems` | Register a provider and read or update its items. |
| `secrets` | Plugin-ID-scoped operating-system credential storage. |
| `commands` | Register and handle plugin-scoped commands. |
| `ui` | Declare renderer views, routes, navigation, and settings surfaces. |
| `background` | Schedule bounded lifecycle-scoped background work. |
| `network` | Use `ctx.fetch` for declared origins through the host broker. |
| `projects` | Read provider-neutral registered-project descriptors. |
| `nativeProcess` | Execute local programs with user authority; high risk. |
| `environment` | Read only the exact declared host variable names. |

Network entries are origins, not URL prefixes: scheme, canonical hostname pattern,
and optional port, with no path, query, credentials, or fragment. HTTPS is required
except for loopback HTTP. `*` and `*.example.com` are HTTPS-only. Every redirect is
checked again.

## Settings schema

`settings_schema` is a strict JSON-Schema-like object with `type: 'object'`, at most
256 `properties`, and optional `required`. Property names cannot be `__proto__`,
`prototype`, or `constructor`. Each property may declare `type` (`string`, `number`,
or `boolean`), `title`, `description`, `placeholder`, `default`, `minimum`, `maximum`,
and an `enum` of at most 256 values.

## UI contributions

Routes contain `id`, lowercase path syntax (`[a-z0-9/_-]`), and a declared `view`.
Navigation contains `id`, `label`, optional icon and order, and a route ID. Settings
contains the same identity fields plus a group (`Settings`, `Integrations`, or
`System`). References to undeclared routes or views are invalid. All host URLs are
namespaced under `/plugin/<plugin-id>/*`.

Invalid examples include `entry: '../index.js'`, an HTTP update URL, `network`
without hosts, duplicate permissions, a settings contribution without `ui`, or a
route that names an undeclared renderer view.
