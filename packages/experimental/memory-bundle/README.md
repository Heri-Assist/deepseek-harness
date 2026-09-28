---
description: "Add durable layered memory and the remember, recall, and forget tools from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-memory-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle inserts the one memory row the shipped composition leaves out: `memory`, which owns a durable SQLite store under `$DSH_HOME` and registers three model tools. Shipped profiles leave it switched off.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select Agent Memory in the Plugins list. A live root Agent then receives `remember`, `recall`, and `forget`, and facts written in one Session are retrievable in a later Session of the same installation. Keeping the default `global` scope shares a fact across projects; `project` binds a record to one workspace id and `task` to one board task. The store lives at `$DSH_HOME/memory/memory.sqlite`, so facts survive Session deletion and process restarts. Disabling the bundle removes the tools and leaves the stored records on disk.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` inserts the `memory` row, and `package.json` depends on `@deepseek-ai/dsh-memory` so the row resolves from this bundle. No runtime invariant companion is published because the store's own constraints are enforced inside the service.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the `memory` row |
| [`package.json`](package.json) | The row package as a dependency |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | Plugin-manager title and description |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory service](../../memory/memory/README.md) — the store, scopes, and tool schemas.
- [Web bundle](../../bundle/web-app/README.md) — the composition this bundle adds the row to.

-----

<a id="model-experience"></a>
## Model Experience

### Memory tools

#### What the model sees

A live root Agent gains `remember`, `recall`, and `forget`. `remember` takes the fact text, an optional scope, key, tags, owning ids, and a pinned flag; `recall` returns the best keyword matches within the requested scope; `forget` soft-deletes one record by id.

#### Token effect

Selecting the bundle adds three tool schemas to every live root Agent request; the returned records appear only inside the tool result that requested them.

#### KV Cache effect

The tool schemas change the request prefix once when the bundle mounts; recall results are new content after that prefix, so existing entries are not invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Recall is keyword and tag search over an FTS5 index; it does not match paraphrases that share no term with the stored text.
- Extraction is not automatic: a fact is stored only when the model calls `remember`. Automatic extraction from compaction summaries and board-task completion is deferred.
- Automatic recall injection at `agent/pre-step` is deferred; the model must call `recall` itself.
- Memory text is not passed through a secret redactor, because the harness has no free-text redactor; do not store credentials.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
