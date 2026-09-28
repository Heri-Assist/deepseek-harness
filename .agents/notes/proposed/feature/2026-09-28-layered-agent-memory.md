# Agent Note: Layered agent memory

Status: proposed

English | [中文](2026-09-28-layered-agent-memory.zh.md)

## Problem

The harness has no memory subsystem. The session log is the source of truth for one conversation, compaction summarizes old history under token pressure, spill and attachments offload bulky content, and skills carry procedural knowledge — but nothing remembers a durable fact after the session that produced it ends. Cross-session knowledge exists only through an external MCP memory server configured per deployment. Retrieval is recency-based: compaction condenses the oldest head of the surface, and a compacted summary discards details that a later task needed. A work item dispatched by [the board](2026-09-28-worktree-isolated-agent-board.md) starts with no record of what previous attempts learned, and a resumed task re-derives context that was already established.

## Proposal

A memory capability with a definition, one storage provider, and tool, context, and compaction consumers, composed under `packages/memory/`.

- `@deepseek-ai/dsh-memory` defines `ctx.memory`: the record model, scopes, `remember`, `recall`, `search`, and `forget` operations, limits, and the `memory/changed` notification.
- `@deepseek-ai/dsh-memory-sqlite` provides the store: one SQLite database under `$DSH_HOME` with an FTS5 `unicode61` index over text and tags, a monotonic schema version, and per-scope columns, following the `session-query-sqlite` patterns.
- `@deepseek-ai/dsh-tool-memory` registers the model tools `remember`, `recall`, and `forget`, each recording source on write.
- `@deepseek-ai/dsh-memory-context` retrieves on `agent/pre-step` and injects results as durable user messages.
- `@deepseek-ai/dsh-memory-compaction` extracts durable facts when a compaction summary commits and when a board task completes, and keeps pinned records available across compaction.
- `packages/client/ui-memory` renders a Settings page to browse, search, edit, and forget records by scope.

### Memory model

A record carries a branded id, a scope, the owning workspace id and task id where applicable, an optional key, tags, text, source, a pinned flag, an optional supersedes id, a deleted tombstone, and created, updated, last-used, and use-count fields. Source records the producing session id, event sequence, tool call id when present, and an origin of `explicit` or `extracted`. Text passes through the existing secret redactor before storage; credentials are never persisted as memory.

### Scopes and lifecycle

Scopes are layered: `global` for user facts and preferences, `project` for repository conventions and decisions, and `task` for the reusable context of one work item. Writes choose the narrowest applicable scope; the extraction consumer writes only `project` and `task`, while `global` is written by an explicit tool call or a human edit. Forget is a soft delete that keeps an auditable tombstone, and a configured expiration removes records unused past a retention window or above a per-scope cap.

### Retrieval and injection

Retrieval is keyword and tag search over the FTS5 index. Queries combine terms from the incoming message batch, the active goal, and the board task's title, description, and labels. Results are ranked, cut to a configured top-k, and costed through `ctx.tokenMeter` against a per-injection token budget. The context consumer injects selected records at `agent/pre-step` as durable user messages carrying the `recall` form and a source header, so what reaches the model stays reconstructable from the session log. Injected text is marked untrusted, exactly like a session-reference snapshot: it is information, never an instruction, and never executes. A per-session projection deduplicates records already injected in the conversation.

### Context efficiency

Memory complements compaction rather than replacing it. When compaction summarizes a region, the compaction consumer asks the model for durable facts in the same call and stores them at project or task scope; a compacted summary can then shed detail that survives in the memory store and is re-retrieved only when relevant. Pinned records are re-injected after a compaction boundary so a decision the session is working under cannot be summarized away. Extraction reuses the `compaction` purpose on the existing generation options instead of extending that union, which avoids touching `dsh-llm`.

## Alternatives considered

### Why not ship only the external MCP memory servers?

The deployment already carries optional MCP memory examples, and they need no harness code. They also live outside the session log's reconstructability, cannot scope records to a workspace or a board task, cannot participate in compaction, and require the user to run and account for a separate server. The native seam keeps retrieval inside the same source and redaction rules as the rest of the harness, and MCP remains the route for external knowledge stores.

### Why not embeddings and a vector store?

Semantic retrieval generally recalls more paraphrase matches, but the harness has no embedding provider, no vector index, and no benchmark showing the recall gain justifies a new external model call on every write and query. FTS5 is deterministic, testable without a model, and already proven in `session-query-sqlite`. The definition leaves retrieval behind `ctx.memory`, so an embedding provider can replace the ranking later without changing consumers.

### Why not store only compaction summaries?

Keeping summaries as the memory would avoid a second store, but a summary is bound to one session's surface region and is written under pressure, not when a fact is learned. Retrieval by recency over summaries re-reads whole regions instead of the one fact a task needs, and deleting a session deletes its knowledge. The layered store separates durable facts from the conversation that produced them.

### Why not declare memory events in the session log?

The session log is append-only and per-session, while memory is project-scoped, mutable, and shared across sessions; recording every write as a session event would either pick one owning session for shared state or duplicate state. Model-visible recall travels as a user message, so the existing reconstructability rule already holds without a new event type or format version.

## Acceptance criteria

- A fact written in one session is retrievable by keyword in a fresh session of the same workspace.
- Records are scoped: a task-scoped record is not injected into an unrelated task, and a project-scoped record is not injected into another workspace.
- Every injected record is a durable user message with the recall form and source; the session log alone can reconstruct what the model received.
- Compaction extracts durable facts and re-injects pinned records after the summary commits.
- A stored record never contains a value the secret redactor would remove, and forget leaves an auditable tombstone.

## Risks

- Automatic extraction costs a model call and can persist a wrong or misleading fact; extraction is configured, scoped narrowly by default, and every record carries source for review.
- Recalled text is untrusted input; a record shaped as an instruction must not change behavior beyond the prompt-injection defenses that already apply to session-reference snapshots.
- An unbounded store degrades retrieval quality; top-k, token budgets, caps, and expiration are configuration, and the UI exposes deletion.
- FTS5 tokenization ranks exact terms well and paraphrases poorly; the definition's retrieval boundary is the documented place to swap in semantic ranking when evidence justifies it.