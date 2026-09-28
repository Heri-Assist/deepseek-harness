/**
 * Project-scoped agent task board. Tasks live in a durable domain keyed by
 * workspace, carry a compare-and-set revision, and derive readiness from their
 * dependency edges.
 *
 * @module @deepseek-ai/dsh-board
 */

import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { registerBoardTools } from './tools.ts'
import { boardDomain } from './schema.ts'
import {
  BOARD_TASK_STATUSES,
  BoardConflictError,
  BoardInputError,
  BoardNotFoundError,
  BoardTaskId,
} from './types.ts'
import type {
  BoardAssignee,
  BoardCreateInput,
  BoardListQuery,
  BoardTask,
  BoardUpdateInput,
} from './types.ts'

export type * from './types.ts'
export { BOARD_TASK_STATUSES, BoardConflictError, BoardInputError, BoardNotFoundError, BoardTaskId } from './types.ts'
export { boardDomain, boardTaskSchema } from './schema.ts'
export { registerBoardTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable project-scoped task board. */
    board: BoardService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A board task was created, changed, or cancelled; clients refetch.
     * @mode emit
     */
    'board/changed'(): void
  }
}

/** Board configuration. */
export interface Config {
  /** Maximum tasks retained per workspace; defaults to 256. */
  maxTasksPerWorkspace?: number
}

/** Retained tasks per workspace applied when the deployment states none. */
export const DEFAULT_MAX_TASKS_PER_WORKSPACE = 256

/** Schemastery configuration for the board service. */
export const Config: z<Config> = z.object({
  maxTasksPerWorkspace: z.number().step(1).min(1).max(100_000).default(DEFAULT_MAX_TASKS_PER_WORKSPACE),
})

/** Reject a dependency graph that is cyclic or references a missing task. */
function assertGraph(tasks: readonly BoardTask[]): void {
  const byId = new Map<BoardTaskId, BoardTask>(tasks.map(task => [task.id, task]))
  for (const task of tasks) {
    for (const blocker of task.blockedBy) {
      if (!byId.has(blocker)) throw new BoardInputError(`task ${task.id} is blocked by unknown task ${blocker}`)
      if (blocker === task.id) throw new BoardInputError(`task ${task.id} cannot block itself`)
    }
  }
  const visiting = new Set<BoardTaskId>()
  const visited = new Set<BoardTaskId>()
  const visit = (id: BoardTaskId): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new BoardInputError(`dependency cycle through task ${id}`)
    visiting.add(id)
    const task = byId.get(id)
    if (task !== undefined) for (const blocker of task.blockedBy) visit(blocker)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)
}

/** Whether a backlog task's dependencies have all reached `done`. */
function isReady(task: BoardTask, byId: ReadonlyMap<string, BoardTask>): boolean {
  return task.status === 'backlog' && task.blockedBy.every(id => byId.get(id)?.status === 'done')
}

/**
 * Durable, workspace-scoped task board. Mutations are serialized so a
 * compare-and-set never races another write in this process.
 */
export class BoardService extends Service {
  static inject = ['storageDomain', 'tools']

  static Config: z<Config> = Config

  private readonly maxTasksPerWorkspace: number
  private readonly ready: Promise<Domain<typeof boardDomain>>
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Host context carrying storage and the tool registry.
   * @param config - validated board configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'board')
    this.maxTasksPerWorkspace = config.maxTasksPerWorkspace ?? DEFAULT_MAX_TASKS_PER_WORKSPACE
    this.ready = ctx.storageDomain.open(boardDomain)
    ctx.effect(() => async () => {
      const domain = await this.ready
      await domain.close()
    })
    ctx.effect(() => registerBoardTools(ctx, this))
  }

  /** Run one mutation serially, keeping the returned promise on the chain. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.then(() => undefined, () => undefined)
    return next
  }

  private async tasks(): Promise<BoardTask[]> {
    const domain = await this.ready
    return [...domain.table('tasks').entries()].map(([, task]) => task)
  }

  private async require(id: BoardTaskId): Promise<BoardTask> {
    const domain = await this.ready
    const task = domain.table('tasks').get(id)
    if (task === undefined) throw new BoardNotFoundError(`board task ${id} does not exist`)
    return task
  }

  /**
   * Create one task.
   * @param input - board, title, and optional fields.
   * @returns the stored task.
   */
  create(input: BoardCreateInput): Promise<BoardTask> {
    return this.serialize(async () => {
      const title = input.title.trim()
      if (title.length === 0) throw new BoardInputError('board task title must be non-empty')
      const domain = await this.ready
      const all = await this.tasks()
      if (all.filter(task => task.workspaceId === input.workspaceId && task.status !== 'cancelled').length >= this.maxTasksPerWorkspace) {
        throw new BoardInputError(`workspace ${input.workspaceId} already holds ${this.maxTasksPerWorkspace} tasks`)
      }
      const blockedBy = [...new Set(input.blockedBy ?? [])]
      const now = new Date().toISOString()
      const task: BoardTask = {
        id: BoardTaskId(randomUUID()),
        workspaceId: input.workspaceId,
        revision: 1,
        title,
        priority: input.priority ?? 'normal',
        labels: [...new Set(input.labels ?? [])],
        status: 'backlog',
        blockedBy,
        writeScopes: [...new Set(input.writeScopes ?? [])],
        createdAt: now,
        updatedAt: now,
        ...input.description === undefined ? {} : { description: input.description },
      }
      assertGraph([...all, task])
      domain.table('tasks').put(task.id, task)
      this.emitChanged()
      return task
    })
  }

  /**
   * Read one task.
   * @param id - task identity.
   * @returns the stored task.
   */
  get(id: BoardTaskId): Promise<BoardTask> {
    return this.require(id)
  }

  /**
   * List a board's tasks, newest last.
   * @param query - board and optional filters.
   * @returns the matching tasks.
   */
  async list(query: BoardListQuery): Promise<BoardTask[]> {
    const all = (await this.tasks()).filter(task => task.workspaceId === query.workspaceId)
    if (query.readyOnly === true) {
      const byId = new Map(all.map(task => [task.id, task]))
      return all.filter(task => isReady(task, byId))
    }
    return query.status === undefined ? all : all.filter(task => task.status === query.status)
  }

  /**
   * Replace the listed fields of one task under compare-and-set.
   * @param input - task, expected revision, and replacement fields.
   * @returns the updated task.
   */
  update(input: BoardUpdateInput): Promise<BoardTask> {
    return this.serialize(() => this.applyUpdate(input))
  }

  /** Apply one replacement under an already-serialized mutation. */
  private async applyUpdate(input: BoardUpdateInput): Promise<BoardTask> {
    const domain = await this.ready
    const current = await this.require(input.id)
    if (current.revision !== input.revision) {
      throw new BoardConflictError(`board task ${input.id} revision ${String(input.revision)} is stale (current ${String(current.revision)})`)
    }
    const title = input.title === undefined ? current.title : input.title.trim()
    if (title.length === 0) throw new BoardInputError('board task title must be non-empty')
    const status = input.status ?? current.status
    if (!BOARD_TASK_STATUSES.includes(status)) throw new BoardInputError(`unknown board status ${JSON.stringify(status)}`)
    const next: BoardTask = {
      ...current,
      revision: current.revision + 1,
      title,
      priority: input.priority ?? current.priority,
      labels: input.labels === undefined ? current.labels : [...new Set(input.labels)],
      status,
      blockedBy: input.blockedBy === undefined ? current.blockedBy : [...new Set(input.blockedBy)],
      writeScopes: input.writeScopes === undefined ? current.writeScopes : [...new Set(input.writeScopes)],
      updatedAt: new Date().toISOString(),
      ...input.description === undefined ? {} : { description: input.description },
      ...input.assignee === undefined ? {} : { assignee: input.assignee },
    }
    const all = (await this.tasks()).map(task => task.id === next.id ? next : task)
    assertGraph(all)
    domain.table('tasks').put(next.id, next)
    this.emitChanged()
    return next
  }

  /**
   * Move one ready-to-start task to `in_progress` and assign it.
   * @param id - task identity.
   * @param revision - expected current revision.
   * @param assignee - who takes the task.
   * @returns the updated task.
   */
  claim(id: BoardTaskId, revision: number, assignee: BoardAssignee): Promise<BoardTask> {
    return this.serialize(async () => {
      const current = await this.require(id)
      if (current.revision !== revision) {
        throw new BoardConflictError(`board task ${id} revision ${String(revision)} is stale (current ${String(current.revision)})`)
      }
      if (current.status !== 'backlog') {
        throw new BoardInputError(`board task ${id} is ${current.status}, not backlog`)
      }
      return this.applyUpdate({ id, revision, status: 'in_progress', assignee })
    })
  }

  /**
   * Mark one task `done` under compare-and-set.
   * @param id - task identity.
   * @param revision - expected current revision.
   * @returns the updated task.
   */
  complete(id: BoardTaskId, revision: number): Promise<BoardTask> {
    return this.update({ id, revision, status: 'done' })
  }

  /**
   * Cancel one task under compare-and-set.
   * @param id - task identity.
   * @param revision - expected current revision.
   * @returns the updated task.
   */
  cancel(id: BoardTaskId, revision: number): Promise<BoardTask> {
    return this.update({ id, revision, status: 'cancelled' })
  }

  /** Notify listeners after a committed mutation. */
  private emitChanged(): void {
    try {
      this.ctx.emit('board/changed')
    } catch (error: unknown) {
      this.ctx.logger.warn(`board: board/changed listener failed: ${String(error)}`)
    }
  }
}

export default BoardService
