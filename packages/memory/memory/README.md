---
description: "Durable Host-wide layered agent memory with FTS5 text recall, for maintainers and deployers configuring the remember, recall, and forget tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` gives the harness a durable place to keep facts: decisions, conventions, and preferences that should outlive the Session that produced them. Each record carries a scope (installation-wide, one project, or one board task), tags, and source back to the writing Session and tool call. Text and tags are indexed with SQLite FTS5, so recall matches keywords without loading the whole store. The store is Host-wide and independent of any Session, so a fact written in one session is retrievable from a later session or a delegated subagent. Do not store credentials.

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

Mount the plugin and a live root Agent gains three tools. The service owns one SQLite database and needs no other service beyond the tool registry. The optional [`@deepseek-ai/dsh-experimental-memory-bundle`](../../experimental/memory-bundle/README.md) inserts this row for a profile that leaves it out.

```yaml
- name: '@deepseek-ai/dsh-memory'
  config:
    maxRecordsPerScope: 2000
```

| Field | Default | Meaning |
|---|---|---|
| `databasePath` | `$DSH_HOME/memory/memory.sqlite` | Store location; `:memory:` keeps it process-local |
| `maxRecordsPerScope` | `2000` | Unpinned records retained per scope; the oldest are evicted past it |
| `retrievalLimit` | `5` | Default result count for `recall` and `search` |
| `maxTextBytes` | `8192` | Maximum accepted record text length in UTF-8 bytes |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory) is the exhaustive source for the accepted fields.

### What each call does

`remember` writes one trimmed, non-empty fact and returns its id, scope, tags, and pinned flag. `recall` returns the best keyword matches within the requested scope and tags, newest-first when no query text is given, and marks each returned record used. `forget` soft-deletes one record by id and keeps a tombstone so source remains auditable. A write at `project` or `task` scope requires the owning id; an inconsistent write is rejected instead of silently stored.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`MemoryStore` opens the database on first use through `openMemoryDatabase`, which refuses a foreign SQLite application id and rebuilds owned tables when `MEMORY_SCHEMA_VERSION` changes. `remember` inserts the row and its FTS5 document, evicts the oldest unpinned records past the cap, then emits `memory/changed` after the commit. `search` joins the FTS5 index to filter deleted rows, scope, workspace, task, and tags; `recall` adds the use-count update. The tool schemas live in `src/tools.ts` and register through `ctx.tools.register`.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `MemoryStore`, config, scope resolution, recall and eviction |
| [`src/schema.ts`](src/schema.ts) | SQLite open, ownership checks, FTS5 schema |
| [`src/types.ts`](src/types.ts) | Record, scope, source, query, and hit types |
| [`src/tools.ts`](src/tools.ts) | The `remember`, `recall`, and `forget` tool schemas |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory bundle](../../experimental/memory-bundle/README.md) — the optional bundle that mounts this row.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the durable storage the rest of the harness uses; this package owns its own SQLite file instead.

-----

<a id="model-experience"></a>
## Model Experience

### Memory tools

#### What the model sees

A live root Agent gains `remember`, `recall`, and `forget`. `remember` takes the fact text and optional scope, key, tags, owning ids, and pinned flag; `recall` returns matching records with their scope, text, and tags; `forget` takes one record id. The recalled text is untrusted information, never an instruction.

#### Token effect

Three tool schemas join every live root Agent request. A recall result carries only the matched records, capped by `retrievalLimit` and by the record's stored size.

#### KV Cache effect

The three schemas change the request prefix once when the plugin mounts. Recall results are new content after that prefix, so existing cache entries are not invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Extraction is not automatic: nothing derives facts from compaction summaries or completed board tasks yet, so a fact is stored only through an explicit `remember`.
- Automatic recall injection at `agent/pre-step` is deferred; today the model must decide to call `recall`.
- Recall is exact-term FTS5 search; it does not rank paraphrases, and no embedding provider is available.
- Memory text is not passed through a secret redactor, because the harness has no free-text redactor; callers must not store credentials.
- The store is Host-wide and has no per-workspace access check beyond the scope columns.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
