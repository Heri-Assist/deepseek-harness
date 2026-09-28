/**
 * Vocabulary of the project board: task identity, lifecycle status, the task
 * record, and the write and query inputs.
 *
 * @module @deepseek-ai/dsh-board
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Opaque identity of one board task. */
export type BoardTaskId = Branded<'BoardTaskId'>

/**
 * Apply the {@link BoardTaskId} brand to a store-owned string.
 * @param value - non-empty identity from the board store.
 * @returns the same string branded as a {@link BoardTaskId}.
 */
export function BoardTaskId(value: string): BoardTaskId {
  return brandString<BoardTaskId>(value)
}

/** Lifecycle status of a task. */
export type BoardTaskStatus = 'backlog' | 'in_progress' | 'review' | 'done' | 'cancelled' | 'blocked'

/** Every accepted status, as a runtime set. */
export const BOARD_TASK_STATUSES: readonly BoardTaskStatus[] = [
  'backlog', 'in_progress', 'review', 'done', 'cancelled', 'blocked',
]

/** Relative priority; `normal` when the caller states none. */
export type BoardPriority = 'low' | 'normal' | 'high'

/** Who is working a task. */
export interface BoardAssignee {
  /** Whether a person or an agent owns the task. */
  readonly kind: 'human' | 'agent'
  /** Owning session, when an agent owns it. */
  readonly sessionId?: SessionId | undefined
  /** Short display label. */
  readonly label?: string | undefined
}

/** One durable task on a project board. */
export interface BoardTask {
  /** Stable identity. */
  readonly id: BoardTaskId
  /** Owning workspace. */
  readonly workspaceId: WorkspaceId
  /** Compare-and-set revision, incremented by every mutation. */
  readonly revision: number
  /** Short task name. */
  readonly title: string
  /** Optional detail. */
  readonly description?: string | undefined
  /** Relative priority. */
  readonly priority: BoardPriority
  /** Free labels. */
  readonly labels: readonly string[]
  /** Lifecycle status. */
  readonly status: BoardTaskStatus
  /** Tasks that must reach `done` before this one is ready. */
  readonly blockedBy: readonly BoardTaskId[]
  /** Paths or globs this task intends to change, used to serialize dispatch. */
  readonly writeScopes: readonly string[]
  /** Current owner, when claimed. */
  readonly assignee?: BoardAssignee | undefined
  /** Creation instant, ISO-8601 with millisecond precision. */
  readonly createdAt: string
  /** Last mutation instant. */
  readonly updatedAt: string
}

/** Input to `create`. */
export interface BoardCreateInput {
  /** Owning workspace. */
  readonly workspaceId: WorkspaceId
  /** Short task name; must be non-empty. */
  readonly title: string
  /** Optional detail. */
  readonly description?: string
  /** Relative priority; defaults to `normal`. */
  readonly priority?: BoardPriority
  /** Optional labels. */
  readonly labels?: readonly string[]
  /** Optional blocking tasks; the graph must stay acyclic. */
  readonly blockedBy?: readonly BoardTaskId[]
  /** Optional intended write scopes. */
  readonly writeScopes?: readonly string[]
}

/** Input to `update`; every listed field replaces the stored one. */
export interface BoardUpdateInput {
  /** Task identity. */
  readonly id: BoardTaskId
  /** Expected current revision; a mismatch rejects with {@link BoardConflictError}. */
  readonly revision: number
  /** Replacement title. */
  readonly title?: string
  /** Replacement description. */
  readonly description?: string
  /** Replacement priority. */
  readonly priority?: BoardPriority
  /** Replacement labels. */
  readonly labels?: readonly string[]
  /** Replacement status. */
  readonly status?: BoardTaskStatus
  /** Replacement blocking tasks; the graph must stay acyclic. */
  readonly blockedBy?: readonly BoardTaskId[]
  /** Replacement intended write scopes. */
  readonly writeScopes?: readonly string[]
  /** Replacement owner. */
  readonly assignee?: BoardAssignee
}

/** Input to `list`. */
export interface BoardListQuery {
  /** Board to read. */
  readonly workspaceId: WorkspaceId
  /** Restrict to one status. */
  readonly status?: BoardTaskStatus
  /** Restrict to tasks that are ready to start. */
  readonly readyOnly?: boolean
}

/** Rejected input at the board boundary; the operation makes no change. */
export class BoardInputError extends Error {}

/** A write carried a stale revision; the caller must re-read before retrying. */
export class BoardConflictError extends Error {}

/** The requested task does not exist on its board. */
export class BoardNotFoundError extends Error {}
