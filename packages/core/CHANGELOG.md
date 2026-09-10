# Changelog

## [0.1.0](https://github.com/agentkeeper-ai/agentkeeper/compare/core-v0.0.1...core-v0.1.0) (2026-09-10)


### Features

* add adapter-driven harness authentication ([#65](https://github.com/agentkeeper-ai/agentkeeper/issues/65)) ([1119a8e](https://github.com/agentkeeper-ai/agentkeeper/commit/1119a8e1315d2229571aecd2e81c484deb598b80))
* companion mobile app ([#1](https://github.com/agentkeeper-ai/agentkeeper/issues/1)) ([7f9fe25](https://github.com/agentkeeper-ai/agentkeeper/commit/7f9fe259685c6c66212e7fcccd52b01c102db089))
* **harness:** add OpenCode harness adapter and register in registry ([#16](https://github.com/agentkeeper-ai/agentkeeper/issues/16)) ([76e400e](https://github.com/agentkeeper-ai/agentkeeper/commit/76e400ebbbf6231dda9b7a82f6a4429de0c824fa))
* **harness:** auth/availability diagnostics with actionable reasons ([#41](https://github.com/agentkeeper-ai/agentkeeper/issues/41)) ([28f23ec](https://github.com/agentkeeper-ai/agentkeeper/commit/28f23ecdf89e6020cf81dbdf415ec0c963db3bd1))
* **harness:** expose provider metadata and enrich model descriptions ([#43](https://github.com/agentkeeper-ai/agentkeeper/issues/43)) ([b8c7203](https://github.com/agentkeeper-ai/agentkeeper/commit/b8c7203bdb3bc0fd307004a1f94eb191df4a673c))
* manage skills across harnesses ([#79](https://github.com/agentkeeper-ai/agentkeeper/issues/79)) ([0439c8d](https://github.com/agentkeeper-ai/agentkeeper/commit/0439c8da58f11f2ff84ae2d95e690c63533d2ab0))
* **models:** runtime model catalog, custom picker, resolved labels ([#17](https://github.com/agentkeeper-ai/agentkeeper/issues/17)) ([3be9369](https://github.com/agentkeeper-ai/agentkeeper/commit/3be93698afd7d0b42ab04a49a38b0f56f99c9b4d))
* normalize harness model catalogs ([#58](https://github.com/agentkeeper-ai/agentkeeper/issues/58)) ([c8f4c42](https://github.com/agentkeeper-ai/agentkeeper/commit/c8f4c425cd968e55d79cd381811c180ed68a5def))
* session draft prompt redesign plan ([#57](https://github.com/agentkeeper-ai/agentkeeper/issues/57)) ([83a69fd](https://github.com/agentkeeper-ai/agentkeeper/commit/83a69fdfc3a69a736fd80c5329a45c309ff1b8a0))


### Bug Fixes

* **harness:** guard model ids at the harness boundary ([#39](https://github.com/agentkeeper-ai/agentkeeper/issues/39)) ([02b6fad](https://github.com/agentkeeper-ai/agentkeeper/commit/02b6fadcf82ff141111753945759fd3a34ebd52f))
* keep session stream alive while background tasks are outstanding ([#21](https://github.com/agentkeeper-ai/agentkeeper/issues/21)) ([60ffe64](https://github.com/agentkeeper-ai/agentkeeper/commit/60ffe64216c255d900c5536e50f6a64fb1128c48))
* **roles:** drop allowedTools, add disallowedTools plumbing ([#22](https://github.com/agentkeeper-ai/agentkeeper/issues/22)) ([8ac937a](https://github.com/agentkeeper-ai/agentkeeper/commit/8ac937a3a366901a73fe8cb6e8620c8b2b5a2049))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @agentkeeper/sdk bumped to 0.1.0
