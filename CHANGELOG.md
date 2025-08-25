# Changelog

## 1.0.0 (2025-08-25)


### Features

* add enhanced stack trace parsing for automated context collection ([bb127a1](https://github.com/katroc/bugger/commit/bb127a12b2f8756aa9737c3456bd6ec75bbdf491))
* harden MCP server for agent use ([2763b2d](https://github.com/katroc/bugger/commit/2763b2de6921c83360e62f5fc0395ab99788eafd))
* implement content-based context freshness detection ([bb1dae0](https://github.com/katroc/bugger/commit/bb1dae081c562131fabd2249b885696e1d5666a9))
* implement immediate subtask/todo creation during parent task creation ([1ff3441](https://github.com/katroc/bugger/commit/1ff34411cd0e0a396eca1f3128faf246b4200c25))
* implement intelligent auto-generation of subtasks ([4c9ed89](https://github.com/katroc/bugger/commit/4c9ed89419b9f08585e81d01ba31c21dfe2cfc4d))
* implement logical hierarchical workflow - Items → Todos → Subtasks ([71286cd](https://github.com/katroc/bugger/commit/71286cd71f6f837bb8c395deb87655e8189ec428))
* implement Phase 1 - Core Subtasks System ([bb07b55](https://github.com/katroc/bugger/commit/bb07b550e7dcb70a3e4d2389853160629a5a287f))
* Improve CLI output ([9eef4fe](https://github.com/katroc/bugger/commit/9eef4feca7b96d4d8f94d92e73ac70f08b65997c))
* replace emoji-based colors with ANSI colors using chalk ([86d62b0](https://github.com/katroc/bugger/commit/86d62b02d62428d07c84b07828824e0de12c1ff7))
* replace regex-based pattern matching with Tree-sitter AST parsing and remove task management ([288895c](https://github.com/katroc/bugger/commit/288895ca5be0070a4116f63ccbb1e3ad416f9617))


### Bug Fixes

* add proper enum constraints to status fields in MCP tool schema ([f52b77c](https://github.com/katroc/bugger/commit/f52b77c1e52f0afe0b0d4df261cab54f11334d9d))
* add validation for required feature request fields and improve color fallback ([fed53f5](https://github.com/katroc/bugger/commit/fed53f5b3160c0698c2aec526364d6549ba9b7cd))
* change database name back to bugger.db ([0ec16fb](https://github.com/katroc/bugger/commit/0ec16fb5aa1cb2a2f5a93d672cdf2593a5fda16a))
* disable ANSI color codes in MCP environment ([914b25e](https://github.com/katroc/bugger/commit/914b25ea96ca860b7c9e77c1aecdcfbd566442d7))
* resolve context collection issues after text-analysis removal ([2969705](https://github.com/katroc/bugger/commit/2969705de0047a20899a5ca1b80236cd8b4ae15e))
* resolve UNIQUE constraint failed error in bug/feature/improvement creation ([956787f](https://github.com/katroc/bugger/commit/956787f4b9e1e1f9f164095340528d5c8c025209))
