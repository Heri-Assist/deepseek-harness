/**
 * Dispatch orchestration for the board: plan the ready, scope-disjoint tasks,
 * claim each, start a delegated run (optionally in its own worktree), and
 * settle the task to `review` or `blocked`.
 *
 * @module @deepseek-ai/dsh-board-executor
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { BoardAssignee, BoardTask, BoardUpdateInput } from '@deepseek-ai/dsh-board'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { planDispatch } from './plan.ts'

/** The board and agent operations dispatch needs. */
export interface DispatchPorts {
  /** Read one board's tasks. */
  list(workspaceId: string): Promise<BoardTask[]>
  /** List every workspace that currently holds tasks. */
  listWorkspaces(): Promise<string[]>
  /** Read one task's current state. */
  get(id: BoardTask['id']): Promise<BoardTask>
  /** Claim a ready task. */
  claim(id: BoardTask['id'], revision: number, assignee: BoardAssignee): Promise<BoardTask>
  /** Apply a status change under compare-and-set. */
  update(input: BoardUpdateInput): Promise<BoardTask>
  /** Resolve a live Agent by its session, for the child's parent. */
  resolveAgent(sessionId: SessionId): Agent | undefined
  /** Start a delegated run. */
  start(provider: string, request: SubagentStartRequest): Promise<SubagentRun>
}

/** Options for one dispatch pass. */
export interface DispatchOptions {
  /** Board to drive. */
  readonly workspaceId: string
  /** Repository path, required when worktrees are enabled. */
  readonly workspacePath?: string
  /** Named subagent provider. */
  readonly provider: string
  /** Maximum tasks allowed in `in_progress` at once. */
  readonly maxConcurrent: number
  /** Whether each task runs in its own worktree. */
  readonly useWorktrees: boolean
  /** Explicit parent agent; otherwise each task's creator session is resolved. */
  readonly parent?: Agent
  /** Cancellation signal forwarded to every started run. */
  readonly signal: AbortSignal
  /** Worktree creator; required when `useWorktrees` is true. */
  readonly createWorktree?: (taskId: string, workspace: string) => Promise<{ path: string }>
}

/** Which tasks started and which were skipped for lack of a parent. */
export interface DispatchOutcome {
  /** Task ids whose delegated runs started. */
  readonly started: string[]
  /** Task ids skipped because no live parent agent could be resolved. */
  readonly skipped: string[]
}

/**
 * Run one dispatch pass over a board.
 * @param ports - board and agent operations.
 * @param options - provider, concurrency, isolation, and cancellation.
 * @returns the started and skipped task ids.
 */
export async function runDispatch(ports: DispatchPorts, options: DispatchOptions): Promise<DispatchOutcome> {
  const tasks = await ports.list(options.workspaceId)
  const planned = planDispatch(tasks, options.maxConcurrent)
  const started: string[] = []
  const skipped: string[] = []
  for (const task of planned) {
    const parent = options.parent ?? (task.createdBy === undefined ? undefined : ports.resolveAgent(task.createdBy))
    if (parent === undefined) {
      skipped.push(task.id)
      continue
    }
    let cwd: string | undefined
    if (options.useWorktrees && options.createWorktree !== undefined && options.workspacePath !== undefined) {
      cwd = (await options.createWorktree(task.id, options.workspacePath)).path
    }
    await ports.claim(task.id, task.revision, { kind: 'agent', sessionId: parent.session.header.id })
    const prompt = task.description === undefined ? task.title : `${task.title}\n\n${task.description}`
    try {
      const run = await ports.start(options.provider, {
        label: task.title,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: options.signal,
        ...cwd === undefined ? {} : { cwd },
      })
      started.push(task.id)
      void settle(ports, task.id, run)
    } catch {
      // A start failure has no run to settle: release the claimed task as blocked.
      const current = await ports.get(task.id)
      await ports.update({ id: task.id, revision: current.revision, status: 'blocked' })
      skipped.push(task.id)
    }
  }
  return { started, skipped }
}

/** Move one dispatched task to `review` on success or `blocked` on failure. */
async function settle(ports: DispatchPorts, id: BoardTask['id'], run: SubagentRun): Promise<void> {
  const result = await run.result
  const current = await ports.get(id)
  const status = result.stopReason === 'completed' ? 'review' : 'blocked'
  await ports.update({ id, revision: current.revision, status })
}

/** Options for one automatic pass over every board workspace. */
export interface AutoOptions extends Omit<DispatchOptions, 'workspaceId' | 'workspacePath'> {
  /** Repository path per workspace; required when worktrees are enabled. */
  readonly workspacePath?: (workspaceId: string) => Promise<string | undefined> | string | undefined
}

/**
 * Dispatch every workspace that currently holds tasks.
 * @param ports - board and agent operations.
 * @param options - provider, concurrency, isolation, and per-workspace paths.
 * @returns the aggregated started and skipped task ids.
 */
export async function runAuto(ports: DispatchPorts, options: AutoOptions): Promise<DispatchOutcome> {
  const started: string[] = []
  const skipped: string[] = []
  const { workspacePath, ...base } = options
  for (const workspaceId of await ports.listWorkspaces()) {
    let path: string | undefined
    if (options.useWorktrees) {
      path = workspacePath === undefined ? undefined : await workspacePath(workspaceId)
      if (path === undefined) continue
    }
    const outcome = await runDispatch(ports, {
      ...base,
      workspaceId,
      ...path === undefined ? {} : { workspacePath: path },
    })
    started.push(...outcome.started)
    skipped.push(...outcome.skipped)
  }
  return { started, skipped }
}
