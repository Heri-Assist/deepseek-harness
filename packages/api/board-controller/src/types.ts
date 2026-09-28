/**
 * Client-safe request and value types for the generated `board` Remote
 * namespace. Types only — the controller in `index.ts` owns the behavior.
 *
 * @module @deepseek-ai/dsh-api-board-controller/types
 */

import type { BoardPriority, BoardTaskStatus } from '@deepseek-ai/dsh-board'

/** One task as the browser reads it. */
export interface BoardTaskValue {
  /** Task identity. */
  readonly id: string
  /** Owning workspace. */
  readonly workspaceId: string
  /** Compare-and-set revision. */
  readonly revision: number
  /** Short task name. */
  readonly title: string
  /** Optional detail. */
  readonly description?: string
  /** Relative priority. */
  readonly priority: BoardPriority
  /** Free labels. */
  readonly labels: readonly string[]
  /** Lifecycle status. */
  readonly status: BoardTaskStatus
  /** Blocking task ids. */
  readonly blockedBy: readonly string[]
  /** Intended write scopes. */
  readonly writeScopes: readonly string[]
  /** Whether every blocker has reached `done`. */
  readonly ready: boolean
  /** Creation instant. */
  readonly createdAt: string
  /** Last mutation instant. */
  readonly updatedAt: string
}

/** Read one board. */
export interface BoardListRequest {
  /** Workspace whose tasks to list. */
  readonly workspaceId: string
}

/** One board's tasks. */
export interface BoardListValue {
  /** The board's tasks, newest last. */
  readonly tasks: readonly BoardTaskValue[]
}

/** Create one task. */
export interface BoardCreateRequest {
  /** Workspace to add the task to. */
  readonly workspaceId: string
  /** Short task name. */
  readonly title: string
  /** Optional detail. */
  readonly description?: string
  /** Relative priority. */
  readonly priority?: BoardPriority
  /** Optional labels. */
  readonly labels?: readonly string[]
  /** Optional blocking task ids. */
  readonly blockedBy?: readonly string[]
  /** Optional intended write scopes. */
  readonly writeScopes?: readonly string[]
}

/** Change one task under compare-and-set. */
export interface BoardUpdateRequest {
  /** Task identity. */
  readonly id: string
  /** Expected current revision. */
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
  /** Replacement blocking task ids. */
  readonly blockedBy?: readonly string[]
  /** Replacement intended write scopes. */
  readonly writeScopes?: readonly string[]
}
