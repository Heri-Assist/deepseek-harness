/**
 * Host board Remote owner: reads a workspace's tasks and applies one
 * create or compare-and-set update for the browser, over the generated `board`
 * namespace.
 *
 * @module @deepseek-ai/dsh-api-board-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { BoardConflictError, BoardInputError, BoardNotFoundError, BoardTaskId } from '@deepseek-ai/dsh-board'
import type { BoardTask } from '@deepseek-ai/dsh-board'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  BoardCreateRequest,
  BoardListRequest,
  BoardListValue,
  BoardTaskValue,
  BoardUpdateRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host board Remote namespace owner. */
    boardController: BoardController
  }
}

/** Convert one stored task, marking readiness from the board it belongs to. */
function toValue(task: BoardTask, byId: ReadonlyMap<string, BoardTask>): BoardTaskValue {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    revision: task.revision,
    title: task.title,
    priority: task.priority,
    labels: [...task.labels],
    status: task.status,
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
    ready: task.status === 'backlog' && task.blockedBy.every(id => byId.get(id)?.status === 'done'),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...task.description === undefined ? {} : { description: task.description },
  }
}

/** Map a board failure to the Remote wire error the browser receives. */
function asRemoteError(error: unknown): RemoteError {
  if (error instanceof BoardConflictError || error instanceof BoardInputError || error instanceof BoardNotFoundError) {
    return new RemoteError('gateway/bad-request', error.message, {})
  }
  return new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}, { cause: error })
}

/** Host service backing the generated `ctx.remote.board` namespace. */
export class BoardController extends TypertRemoteService {
  static inject = ['board']

  /**
   * @param ctx - Host context carrying the board store.
   */
  constructor(ctx: Context) {
    super(ctx, 'boardController', { namespace: 'board' })
  }

  /**
   * List one workspace's tasks.
   * @param request - workspace to read.
   * @returns the board's tasks with derived readiness.
   */
  @Remote('list')
  async list(request: BoardListRequest): Promise<BoardListValue> {
    try {
      const tasks = await this.ctx.board.list({ workspaceId: WorkspaceId(request.workspaceId) })
      const byId = new Map(tasks.map(task => [task.id, task]))
      return { tasks: tasks.map(task => toValue(task, byId)) }
    } catch (error: unknown) {
      throw asRemoteError(error)
    }
  }

  /**
   * Create one task on a board.
   * @param request - workspace, title, and optional fields.
   * @returns the created task.
   */
  @Remote('create')
  async create(request: BoardCreateRequest): Promise<BoardTaskValue> {
    try {
      const task = await this.ctx.board.create({
        workspaceId: WorkspaceId(request.workspaceId),
        title: request.title,
        ...request.description === undefined ? {} : { description: request.description },
        ...request.priority === undefined ? {} : { priority: request.priority },
        ...request.labels === undefined ? {} : { labels: request.labels },
        ...request.blockedBy === undefined ? {} : { blockedBy: request.blockedBy.map(BoardTaskId) },
        ...request.writeScopes === undefined ? {} : { writeScopes: request.writeScopes },
      })
      return toValue(task, new Map([[task.id, task]]))
    } catch (error: unknown) {
      throw asRemoteError(error)
    }
  }

  /**
   * Change one task under compare-and-set.
   * @param request - task, expected revision, and replacement fields.
   * @returns the updated task.
   */
  @Remote('update')
  async update(request: BoardUpdateRequest): Promise<BoardTaskValue> {
    try {
      const task = await this.ctx.board.update({
        id: BoardTaskId(request.id),
        revision: request.revision,
        ...request.title === undefined ? {} : { title: request.title },
        ...request.description === undefined ? {} : { description: request.description },
        ...request.priority === undefined ? {} : { priority: request.priority },
        ...request.labels === undefined ? {} : { labels: request.labels },
        ...request.status === undefined ? {} : { status: request.status },
        ...request.blockedBy === undefined ? {} : { blockedBy: request.blockedBy.map(BoardTaskId) },
        ...request.writeScopes === undefined ? {} : { writeScopes: request.writeScopes },
      })
      const tasks = await this.ctx.board.list({ workspaceId: task.workspaceId })
      return toValue(task, new Map(tasks.map(candidate => [candidate.id, candidate])))
    } catch (error: unknown) {
      throw asRemoteError(error)
    }
  }
}

export default BoardController
