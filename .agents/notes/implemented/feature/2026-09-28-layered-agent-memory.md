# Agent Note: Layered agent memory

Status: implemented

English | [中文](2026-09-28-layered-agent-memory.zh.md)

## Problem

The harness had no memory subsystem. The session log is the source of truth for one conversation, compaction summarizes old history under token pressure, spill and attachments offload bulky content, and skills carry procedural knowledge — but nothing remembered a durable fact after the session that produced it ended. Cross-session knowledge existed only through an external MCP memory server configured per deployment. Retrieval was recency-based: compaction condensed the oldest head of the surface, and a compacted summary discarded details a later task needed. A work item dispatched by [the board](2026-09-28-worktree-isolated-agent-board.md) started with no record of what previous attempts learned.

## Decision

One memory package plus a context consumer, composed under `packages/memory/`.

- `@deepseek-ai/dsh-memory` defines `ctx.memory` and owns the store: the record model, scopes, `remember`, `recall`, `search`, `forget`, and `list`; one SQLite database under `$DSH_HOME/memory/memory.sqlite` with an FTS5 `unicode61` index over text and tags, a monotonic `MEMORY_SCHEMA_VERSION`, and an application id that refuses a foreign database; the model tools `remember`, `recall`, and `forget`; and the `memory/changed` notification. The store is keyword and tag search only.
- `@deepseek-ai/dsh-memory-context` retrieves on `agent/pre-step` and injects results as durable user messages, searches a configured `global`, `project`, or `task` scope, and — with `extractOnCompaction` — stores each committed `compaction/summary` as one `project`-scope fact.

### Memory model

A record carries a branded `MemoryId`, a `MemoryScope` of `global`, `project`, or `task`, the owning `workspaceId` and `taskId` where applicable, an optional `key` and `tags`, the fact `text`, `MemorySource`, a `pinned` flag, a `deleted` tombstone, and created, updated, last-used, and use-count fields. `MemorySource` records the producing session id, event sequence, and tool call id when present, plus an origin of `explicit` or `extracted`. A `project` write requires a workspace id and a `task` write also requires a task id; a write missing either is rejected with `MemoryInputError` before storage. Text is trimmed, bounded by `maxTextBytes`, and passed through no redactor — the harness has no free-text redactor, so callers must not write credentials.

### Scopes and lifecycle

Scopes are layered: `global` for user facts and preferences, `project` for repository conventions and decisions, and `task` for the reusable context of one work item. The extraction consumer writes `project` at the configured workspace or the session's working directory; `global` is written by an explicit tool call. `forget` is a soft delete that keeps an auditable tombstone, and each write evicts the oldest unpinned records past `maxRecordsPerScope`, keeping the oldest first by a stable `(updated_at, rowid)` order.

### Retrieval and injection

Retrieval is keyword and tag search over the FTS5 index, with `match: 'all'` or `'any'` and per-scope filters. The context consumer builds a query from the content terms of the incoming messages (stopwords and very short tokens dropped), searches each eligible scope with `match: 'any'`, ranks the merged hits by FTS5 score, cuts them to a configured `limit` and `maxChars`, and appends one durable `user/message` carrying the `recall` form and the record ids. Injected text is marked as notes from earlier sessions and is information, never an instruction. The `memoryContext` session projection folds the injected record ids so a session never injects the same record twice. A session's injected set is capped at 500 ids.

### Context efficiency

Memory complements compaction rather than replacing it. `memory-context` extracts each committed summary into `project` memory as a `compaction-summary`-tagged fact, so a compacted summary can shed a detail that survives in the memory store and is re-retrieved only when relevant. Recall searches `project` and `task` only when the deployment names a `workspaceId`, because a session does not carry its workspace identity into this plugin.

## Alternatives considered

### Why not ship only the external MCP memory servers?

The deployment already carries optional MCP memory examples, and they need no harness code. They also live outside the session log's reconstructability, cannot scope records to a workspace or a board task, cannot participate in compaction, and require the user to run and account for a separate server. The native capability keeps retrieval inside the same source rules as the rest of the harness, and MCP remains the route for external knowledge stores.

### Why not embeddings and a vector store?

Semantic retrieval generally recalls more paraphrase matches, but the harness has no embedding provider, no vector index, and no benchmark showing the recall gain justifies a new external model call on every write and query. FTS5 is deterministic, testable without a model, and already proven in `session-query-sqlite`. The capability leaves retrieval behind `ctx.memory`, so an embedding provider can replace the ranking later without changing consumers.

### Why not store only compaction summaries?

Keeping summaries as the memory would avoid a second store, but a summary is bound to one session's surface region and is written under pressure, not when a fact is learned. Retrieval by recency over summaries re-reads whole regions instead of the one fact a task needs, and deleting a session deletes its knowledge. The layered store separates durable facts from the conversation that produced them.

### Why not declare memory events in the session log?

The session log is append-only and per-session, while memory is project-scoped, mutable, and shared across sessions; recording every write as a session event would either pick one owning session for shared state or duplicate state. Model-visible recall travels as a user message, so the existing reconstructability rule already holds without a new event type or format version. Adding the `memory-context` user-message source kind was the one persisted-type change, acknowledged as a same-version additive arm.

### Why not separate definition, store, and tool packages?

The first implementation keeps `ctx.memory`, its SQLite store, and its tools in one package. The record model, the store, and the tools evolved together and have no independent provider, so splitting them would create an inter-package seam with one implementation on each side. A later provider or a second store can split the definition out without changing the consumers.

## Consequences

- No `ui-memory` page ships: the store is read and written through the model tools, and a human edits it only through those tools.
- Recall is exact-term FTS5; paraphrase and semantic similarity are out of scope.
- The stopword list is English; other languages fall back to a length filter.
- Text is not redacted, because the harness has no free-text redactor; the store documents that callers must not write credentials.
- Extraction reads `compaction/summary` only; nothing derives facts from ordinary turns.
- `stateVersion` for the `memoryContext` projection is 1; the projection folds a wire payload of record ids and a timestamp.
