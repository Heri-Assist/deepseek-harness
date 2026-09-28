/**
 * Board executor: a Host-facing dispatcher that turns ready board tasks into
 * delegated subagent runs, optionally isolated in their own git worktrees.
 *
 * @module @deepseek-ai/dsh-board-executor
 */

import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-board'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorktreeManager } from './worktrees.ts'
import { runDispatch } from './dispatch.ts'
import type { DispatchOutcome, DispatchPorts } from './dispatch.ts'

export type * from './dispatch.ts'
export { runDispatch } from './dispatch.ts'
export { planDispatch, scopesOverlap } from './plan.ts'
export { WorktreeManager } from './worktrees.ts'
export type { WorktreeRef } from './worktrees.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-facing board dispatcher. */
    boardExecutor: BoardExecutor
  }
}

/** Executor configuration. */
export interface Config {
  /** Named subagent provider used for delegated runs. */
  provider?: string
  /** Maximum tasks allowed in `in_progress` at once; defaults to 1. */
  maxConcurrent?: number
  /** Whether each task runs in its own worktree; defaults to true. */
  useWorktrees?: boolean
  /** Worktree root; defaults to `$DSH_HOME/worktrees`. */
  worktreeRoot?: string
  /** Branch-name prefix for created worktrees; defaults to `board/`. */
  branchPrefix?: string
}

/** Schemastery configuration for the executor. */
export const Config: z<Config> = z.object({
  provider: z.string().min(1),
  maxConcurrent: z.number().step(1).min(1).max(64).default(1),
  useWorktrees: z.boolean().default(true),
  worktreeRoot: z.string().min(1),
  branchPrefix: z.string().min(1).default('board/'),
})

/** One dispatch request from a Host caller. */
export interface DispatchRequest {
  /** Board to drive. */
  readonly workspaceId: string
  /** Repository path; required when worktrees are enabled. */
  readonly workspacePath?: string
  /** Provider override for this pass. */
  readonly provider?: string
  /** Explicit parent agent; otherwise each task's creator session is resolved. */
  readonly parent?: Agent
}

/** Dispatch ready tasks on a board to delegated runs. */
export class BoardExecutor extends Service {
  static inject = ['board', 'subagents', 'agents']

  static Config: z<Config> = Config

  private readonly config: Config
  private readonly controller = new AbortController()
  private manager: WorktreeManager | undefined

  /**
   * @param ctx - Host context carrying the board, subagents, and agents services.
   * @param config - validated executor configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'boardExecutor')
    this.config = config
    ctx.effect(() => () => {
      this.controller.abort()
    })
  }

  /**
   * Run one dispatch pass.
   * @param request - board, optional repository path, and optional parent.
   * @returns the started and skipped task ids.
   */
  dispatch(request: DispatchRequest): Promise<DispatchOutcome> {
    const provider = request.provider ?? this.config.provider
    if (provider === undefined) throw new Error('board-executor: no subagent provider configured')
    const useWorktrees = this.config.useWorktrees ?? true
    const manager = useWorktrees ? this.worktrees() : undefined
    const ports: DispatchPorts = {
      list: workspaceId => this.ctx.board.list({ workspaceId: WorkspaceId(workspaceId) }),
      get: id => this.ctx.board.get(id),
      claim: (id, revision, assignee) => this.ctx.board.claim(id, revision, assignee),
      update: input => this.ctx.board.update(input),
      resolveAgent: sessionId => this.ctx.agents.get(sessionId),
      start: (name, subagentRequest) => this.ctx.subagents.start(name, subagentRequest),
    }
    return runDispatch(ports, {
      workspaceId: request.workspaceId,
      provider,
      maxConcurrent: this.config.maxConcurrent ?? 1,
      useWorktrees,
      signal: this.controller.signal,
      ...request.workspacePath === undefined ? {} : { workspacePath: request.workspacePath },
      ...request.parent === undefined ? {} : { parent: request.parent },
      ...manager === undefined ? {} : { createWorktree: (taskId, workspace) => manager.create(taskId, workspace) },
    })
  }

  /** Lazily create the worktree manager. */
  private worktrees(): WorktreeManager {
    this.manager ??= new WorktreeManager(
      this.config.worktreeRoot ?? dshHomePath('worktrees'),
      this.config.branchPrefix ?? 'board/',
    )
    return this.manager
  }
}

export default BoardExecutor
