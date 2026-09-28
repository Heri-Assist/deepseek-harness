/**
 * Vocabulary of the durable layered memory store: record identity, scope,
 * source, write and query inputs, and ranked results.
 *
 * @module @deepseek-ai/dsh-memory
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Opaque identity of one durable memory record. */
export type MemoryId = Branded<'MemoryId'>

/**
 * Apply the {@link MemoryId} brand to a store-owned string.
 * @param value - non-empty identity from the memory store.
 * @returns the same string branded as a {@link MemoryId}.
 */
export function MemoryId(value: string): MemoryId {
  return brandString<MemoryId>(value)
}

/** Layer a record belongs to: user-wide, project-wide, or one board task. */
export type MemoryScope = 'global' | 'project' | 'task'

/** The scopes accepted by every write and query, as a runtime set. */
export const MEMORY_SCOPES: readonly MemoryScope[] = ['global', 'project', 'task']

/**
 * How a record entered the store: written by the model's own tool call, or
 * extracted automatically by a compaction or task-completion policy.
 */
export type MemoryOrigin = 'explicit' | 'extracted'

/** Durable source of one record, retained for audit and review. */
export interface MemorySource {
  /** Session whose work produced the fact, when one owns it. */
  readonly sessionId?: SessionId
  /** Session-log sequence of the producing event, when known. */
  readonly eventSeq?: number
  /** Tool call that wrote the fact, when a tool call did. */
  readonly toolCallId?: string
  /** Whether a model tool call or an extraction policy produced the record. */
  readonly origin: MemoryOrigin
}

/** One durable fact with its scope, tags, and source. */
export interface MemoryRecord {
  /** Stable identity. */
  readonly id: MemoryId
  /** Layer this record belongs to. */
  readonly scope: MemoryScope
  /** Owning workspace, required for `project` and `task` scopes. */
  readonly workspaceId?: string
  /** Owning board task, required for the `task` scope. */
  readonly taskId?: string
  /** Optional short lookup key, unique within its scope. */
  readonly key?: string
  /** Free labels used for tag filtering. */
  readonly tags: readonly string[]
  /** The remembered fact. */
  readonly text: string
  /** Where the fact came from. */
  readonly source: MemorySource
  /** Pinned records survive scope eviction and are re-injected after compaction. */
  readonly pinned: boolean
  /** Record this one replaces, when the write superseded an earlier fact. */
  readonly supersedes?: MemoryId
  /** Creation instant, ISO-8601 with millisecond precision. */
  readonly createdAt: string
  /** Last mutation instant. */
  readonly updatedAt: string
  /** Last recall that returned this record. */
  readonly lastUsedAt?: string
  /** Number of recalls that returned this record. */
  readonly useCount: number
}

/** Input to `remember`. */
export interface RememberInput {
  /** The fact text; must be non-empty. */
  readonly text: string
  /** Target layer; defaults to `global`. */
  readonly scope?: MemoryScope
  /** Optional short lookup key. */
  readonly key?: string
  /** Optional labels. */
  readonly tags?: readonly string[]
  /** Owning workspace; required for `project` and `task` scopes. */
  readonly workspaceId?: string
  /** Owning board task; required for the `task` scope. */
  readonly taskId?: string
  /** Pin the record against scope eviction. */
  readonly pinned?: boolean
  /** Where the fact came from. */
  readonly source: MemorySource
}

/** Input to `recall`, `search`, and `list`. */
export interface MemoryQuery {
  /** Text terms matched against record text and tags. */
  readonly text?: string
  /** Labels a record must carry; all must match. */
  readonly tags?: readonly string[]
  /** Restrict to one layer. */
  readonly scope?: MemoryScope
  /** Restrict to one workspace. */
  readonly workspaceId?: string
  /** Restrict to one board task. */
  readonly taskId?: string
  /** Maximum results; defaults to the configured retrieval limit. */
  readonly limit?: number
}

/** One ranked result. */
export interface MemoryHit {
  /** The matched record. */
  readonly record: MemoryRecord
  /** FTS5 rank, lower is a better match. */
  readonly rank: number
}

/** Rejected input at the memory boundary; the operation makes no change. */
export class MemoryInputError extends Error {}
