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
import { runAuto, runDispatch } from './dispatch.ts'
import type { DispatchOutcome, DispatchPorts } from './dispatch.ts'

export type * from './dispatch.ts'
export { runAuto, runDispatch } from './dispatch.ts'
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
  /** Dispatch automatically on every committed board change; defaults to false. */
  auto?: boolean
  /** Attempts allowed per task before a failure leaves it `blocked`; defaults to 1. */
  maxAttempts?: number
}

/** Configuration after schema defaults are applied. */
type ResolvedConfig = Required<Omit<Config, 'provider'>> & Pick<Config, 'provider'>

/** Schemastery configuration for the executor. */
export const Config: z<Config, ResolvedConfig> = z.object({
  provider: z.string().min(1),
  maxConcurrent: z.number().step(1).min(1).max(64).default(1),
  useWorktrees: z.boolean().default(true),
  worktreeRoot: z.string().min(1).default(dshHomePath('worktrees')),
  branchPrefix: z.string().min(1).default('board/'),
  auto: z.boolean().default(false),
  maxAttempts: z.number().step(1).min(1).max(10).default(1),
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

  static Config: z<Config, ResolvedConfig> = Config

  private readonly config: ResolvedConfig
  private readonly controller = new AbortController()
  private manager: WorktreeManager | undefined
  private autoRunning = false
  private autoQueued = false

  /**
   * @param ctx - Host context carrying the board, subagents, and agents services.
   * @param config - validated executor configuration.
   * @throws when automatic dispatch is enabled without a provider.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'boardExecutor')
    this.config = BoardExecutor.Config(config)
    /* v8 ignore start -- Cordis reports constructor failures on the fiber; the guard stops a misconfigured auto profile */
    if (this.config.auto && this.config.provider === undefined) {
      throw new Error('board-executor: `auto` requires a configured `provider`')
    }
    /* v8 ignore stop */
    ctx.effect(() => () => {
      this.controller.abort()
    })
    if (this.config.auto) {
      ctx.on('board/changed', () => {
        void this.autoPass()
      }, { global: true })
    }
  }

  /**
   * Run one dispatch pass.
   * @param request - board, optional repository path, and optional parent.
   * @returns the started and skipped task ids.
   */
  dispatch(request: DispatchRequest): Promise<DispatchOutcome> {
    const provider = request.provider ?? this.config.provider
    if (provider === undefined) throw new Error('board-executor: no subagent provider configured')
    const manager = this.config.useWorktrees ? this.worktrees() : undefined
    return runDispatch(this.ports(), {
      workspaceId: request.workspaceId,
      provider,
      maxConcurrent: this.config.maxConcurrent,
      useWorktrees: this.config.useWorktrees,
      maxAttempts: this.config.maxAttempts,
      signal: this.controller.signal,
      ...request.workspacePath === undefined ? {} : { workspacePath: request.workspacePath },
      ...request.parent === undefined ? {} : { parent: request.parent },
      ...manager === undefined ? {} : { createWorktree: (taskId, workspace) => manager.create(taskId, workspace) },
    })
  }

  /** Build the board and agent operations the dispatcher calls. */
  private ports(): DispatchPorts {
    return {
      list: workspaceId => this.ctx.board.list({ workspaceId: WorkspaceId(workspaceId) }),
      listWorkspaces: () => this.ctx.board.workspaces().then(ids => ids.map(String)),
      get: id => this.ctx.board.get(id),
      claim: (id, revision, assignee) => this.ctx.board.claim(id, revision, assignee),
      update: input => this.ctx.board.update(input),
      resolveAgent: sessionId => this.ctx.agents.get(sessionId),
      start: (name, subagentRequest) => this.ctx.subagents.start(name, subagentRequest),
    }
  }

  /** Drain one automatic pass, coalescing changes that arrive while it runs. */
  private async autoPass(): Promise<void> {
    if (this.autoRunning) {
      this.autoQueued = true
      return
    }
    this.autoRunning = true
    try {
      do {
        this.autoQueued = false
        await runAuto(this.ports(), {
          // The constructor rejects `auto` without a provider, so the cast records that invariant.
          provider: this.config.provider as string,
          maxConcurrent: this.config.maxConcurrent,
          useWorktrees: this.config.useWorktrees,
          maxAttempts: this.config.maxAttempts,
          signal: this.controller.signal,
          workspacePath: workspaceId => this.workspacePath(workspaceId),
          ...this.worktreeCreator(),
        })
      } while (this.autoQueued)
    } catch (error: unknown) {
      this.ctx.logger.warn(`board-executor: automatic dispatch failed: ${String(error)}`)
    } finally {
      this.autoRunning = false
    }
  }

  /** Resolve a workspace's repository path from the workspace registry. */
  private workspacePath(workspaceId: string): string | undefined {
    return this.ctx.get('workspaceRegistry')?.get(WorkspaceId(workspaceId))?.path
  }

  /** The worktree creator when isolation is enabled, otherwise nothing. */
  private worktreeCreator(): { createWorktree?: (taskId: string, workspace: string) => Promise<{ path: string; branch: string }> } {
    if (!this.config.useWorktrees) return {}
    const manager = this.worktrees()
    return { createWorktree: (taskId, workspace) => manager.create(taskId, workspace) }
  }

  /** Lazily create the worktree manager. */
  private worktrees(): WorktreeManager {
    this.manager ??= new WorktreeManager(this.config.worktreeRoot, this.config.branchPrefix)
    return this.manager
  }
}

export default BoardExecutor
