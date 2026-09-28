/**
 * Model-facing board tools over the Host-wide {@link BoardService}.
 *
 * @module @deepseek-ai/dsh-board
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { BoardTaskId } from './types.ts'
import type { BoardTask, BoardTaskStatus, BoardPriority } from './types.ts'
// The `ctx.board` service declaration lives in src/index.ts (its one home).
import type {} from './index.ts'
import type { BoardService } from './index.ts'

const STATUS_ENUM = ['backlog', 'in_progress', 'review', 'done', 'cancelled', 'blocked'] as const
const PRIORITY_ENUM = ['low', 'normal', 'high'] as const

const TASK_PROPERTIES = {
  id: { type: 'string', required: true },
  workspaceId: { type: 'string', required: true },
  revision: { type: 'integer', required: true },
  title: { type: 'string', required: true },
  status: { type: 'string', required: true, enum: [...STATUS_ENUM] },
  priority: { type: 'string', required: true, enum: [...PRIORITY_ENUM] },
  labels: { type: 'array', required: true, items: { type: 'string' } },
  blockedBy: { type: 'array', required: true, items: { type: 'string' } },
  writeScopes: { type: 'array', required: true, items: { type: 'string' } },
} as const

/** Render one task as a compact line. */
function line(task: BoardTaskView): string {
  const blocked = task.blockedBy.length === 0 ? '' : ` blocked-by [${task.blockedBy.join(', ')}]`
  return `- ${task.id} r${String(task.revision)} [${task.status}/${task.priority}] ${task.title}${blocked}`
}

/** The wire view of one task. */
interface BoardTaskView {
  id: string
  workspaceId: string
  revision: number
  title: string
  status: BoardTaskStatus
  priority: BoardPriority
  labels: string[]
  blockedBy: string[]
  writeScopes: string[]
}

function view(task: BoardTask): BoardTaskView {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    revision: task.revision,
    title: task.title,
    status: task.status,
    priority: task.priority,
    labels: [...task.labels],
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
  }
}

const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: TASK_PROPERTIES,
} as const

/**
 * Register the board tools on `ctx.tools`.
 * @param ctx - context carrying the tool registry.
 * @param board - the board service the tools call.
 * @returns a disposer that unregisters every tool.
 */
export function registerBoardTools(ctx: Context, board: BoardService): () => void {
  const create = ctx.tools.register(defineTool({
    name: 'board_create',
    description: 'Add one task to a project board. Tasks start `backlog`; `blockedBy` lists task ids that must finish first.',
    parameters: {
      workspaceId: { type: 'string', required: true, description: 'Owning workspace id.' },
      title: { type: 'string', required: true, description: 'Short task name.' },
      description: { type: 'string', description: 'Optional detail.' },
      priority: { type: 'string', enum: [...PRIORITY_ENUM], description: 'low | normal (default) | high.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Optional labels.' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: 'Task ids that must reach done first.' },
      writeScopes: { type: 'array', items: { type: 'string' }, description: 'Paths or globs this task intends to change.' },
    },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: line(value) }],
    },
    async execute(args) {
      return view(await board.create({
        workspaceId: WorkspaceId(args.workspaceId),
        title: args.title,
        ...args.description === undefined ? {} : { description: args.description },
        ...args.priority === undefined ? {} : { priority: args.priority as BoardPriority },
        ...args.labels === undefined ? {} : { labels: args.labels },
        ...args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy.map(BoardTaskId) },
        ...args.writeScopes === undefined ? {} : { writeScopes: args.writeScopes },
      }))
    },
    presentCall: args => ({ card: 'generic', title: 'Create board task', kind: 'other', rawInput: args.title }),
  }))

  const list = ctx.tools.register(defineTool({
    name: 'board_list',
    description: 'List a project board. Pass `readyOnly` to see only tasks whose dependencies are all done.',
    parameters: {
      workspaceId: { type: 'string', required: true, description: 'Board to read.' },
      status: { type: 'string', enum: [...STATUS_ENUM], description: 'Restrict to one status.' },
      readyOnly: { type: 'boolean', description: 'Only tasks ready to start.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.length === 0 ? 'No matching tasks.' : value.tasks.map(line).join('\n'),
      }],
    },
    async execute(args) {
      const tasks = await board.list({
        workspaceId: WorkspaceId(args.workspaceId),
        ...args.status === undefined ? {} : { status: args.status as BoardTaskStatus },
        ...args.readyOnly === undefined ? {} : { readyOnly: args.readyOnly },
      })
      return { tasks: tasks.map(view) }
    },
    presentCall: () => ({ card: 'generic', title: 'List board tasks', kind: 'other' }),
  }))

  const get = ctx.tools.register(defineTool({
    name: 'board_get',
    description: 'Read one board task by id.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: line(value) }],
    },
    async execute(args) {
      return view(await board.get(BoardTaskId(args.id)))
    },
    presentCall: () => ({ card: 'generic', title: 'Read board task', kind: 'other' }),
  }))

  const update = ctx.tools.register(defineTool({
    name: 'board_update',
    description: 'Change a board task. Pass the current `revision`; a stale revision fails and you must re-read with board_get or board_list.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      revision: { type: 'integer', required: true, description: 'Current revision from the last read.' },
      title: { type: 'string', description: 'Replacement title.' },
      description: { type: 'string', description: 'Replacement description.' },
      priority: { type: 'string', enum: [...PRIORITY_ENUM], description: 'Replacement priority.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Replacement labels.' },
      status: { type: 'string', enum: [...STATUS_ENUM], description: 'Replacement status.' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: 'Replacement blockers.' },
      writeScopes: { type: 'array', items: { type: 'string' }, description: 'Replacement write scopes.' },
    },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: line(value) }],
    },
    async execute(args) {
      return view(await board.update({
        id: BoardTaskId(args.id),
        revision: args.revision,
        ...args.title === undefined ? {} : { title: args.title },
        ...args.description === undefined ? {} : { description: args.description },
        ...args.priority === undefined ? {} : { priority: args.priority as BoardPriority },
        ...args.labels === undefined ? {} : { labels: args.labels },
        ...args.status === undefined ? {} : { status: args.status as BoardTaskStatus },
        ...args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy.map(BoardTaskId) },
        ...args.writeScopes === undefined ? {} : { writeScopes: args.writeScopes },
      }))
    },
    presentCall: () => ({ card: 'generic', title: 'Update board task', kind: 'other' }),
  }))

  const complete = ctx.tools.register(defineTool({
    name: 'board_complete',
    description: 'Mark a board task done under compare-and-set.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      revision: { type: 'integer', required: true, description: 'Current revision from the last read.' },
    },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: line(value) }],
    },
    async execute(args) {
      return view(await board.complete(BoardTaskId(args.id), args.revision))
    },
    presentCall: () => ({ card: 'generic', title: 'Complete board task', kind: 'other' }),
  }))

  const claim = ctx.tools.register(defineTool({
    name: 'board_claim',
    description: 'Take a ready board task and move it to `in_progress`, recording you as the owner.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      revision: { type: 'integer', required: true, description: 'Current revision from the last read.' },
      label: { type: 'string', description: 'Short owner label.' },
    },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: line(value) }],
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.header.id
      return view(await board.claim(BoardTaskId(args.id), args.revision, {
        kind: 'agent',
        ...sessionId === undefined ? {} : { sessionId },
        ...args.label === undefined ? {} : { label: args.label },
      }))
    },
    presentCall: () => ({ card: 'generic', title: 'Claim board task', kind: 'other' }),
  }))

  return () => {
    create()
    list()
    get()
    update()
    complete()
    claim()
  }
}
