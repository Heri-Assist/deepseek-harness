/**
 * Model-facing memory tools: explicit write, recall, and forget over the
 * Host-wide {@link MemoryStore}.
 *
 * @module @deepseek-ai/dsh-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryId } from './types.ts'
import type { MemoryScope } from './types.ts'
// The `ctx.memory` service declaration lives in src/index.ts (its one home).
import type {} from './index.ts'
import type { MemoryStore } from './index.ts'

const SCOPE_ENUM = ['global', 'project', 'task'] as const

/**
 * Register the memory tools on `ctx.tools`.
 * @param ctx - context carrying the tool registry.
 * @param memory - the memory service the tools call.
 * @returns a disposer that unregisters all three tools.
 */
export function registerMemoryTools(ctx: Context, memory: MemoryStore): () => void {
  const remember = ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Save one durable fact for later sessions. Use it for decisions, conventions, and preferences worth keeping; scope `project` needs a workspaceId, `task` also needs a taskId.',
    parameters: {
      text: { type: 'string', required: true, description: 'The fact to remember — one concrete statement.' },
      scope: { type: 'string', enum: [...SCOPE_ENUM], description: 'global (default) | project | task.' },
      key: { type: 'string', description: 'Optional short lookup key, unique within the scope.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional labels for later tag filtering.' },
      workspaceId: { type: 'string', description: 'Owning workspace; required for project and task scopes.' },
      taskId: { type: 'string', description: 'Owning board task; required for the task scope.' },
      pinned: { type: 'boolean', description: 'Keep this record past scope eviction and across compaction.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          scope: { type: 'string', required: true, enum: [...SCOPE_ENUM] },
          tags: { type: 'array', required: true, items: { type: 'string' } },
          pinned: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Remembered ${value.id} (${value.scope}).`,
      }],
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.header.id
      const record = await memory.remember({
        text: args.text,
        source: {
          origin: 'explicit',
          ...sessionId === undefined ? {} : { sessionId },
          toolCallId: String(exec.callId),
        },
        ...args.scope === undefined ? {} : { scope: args.scope as MemoryScope },
        ...args.key === undefined ? {} : { key: args.key },
        ...args.tags === undefined ? {} : { tags: args.tags },
        ...args.workspaceId === undefined ? {} : { workspaceId: args.workspaceId },
        ...args.taskId === undefined ? {} : { taskId: args.taskId },
        ...args.pinned === undefined ? {} : { pinned: args.pinned },
      })
      return { id: record.id, scope: record.scope, tags: [...record.tags], pinned: record.pinned }
    },
    presentCall: args => ({ card: 'generic', title: 'Remember', kind: 'other', rawInput: args.text }),
  }))

  const recall = ctx.tools.register(defineTool({
    name: 'recall',
    description: 'Look up durable facts saved by `remember`. Returns the best keyword matches within the requested scope; use it before retrying work whose context may already be recorded.',
    parameters: {
      query: { type: 'string', description: 'Words matched against record text and tags.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Only records carrying every listed tag.' },
      scope: { type: 'string', enum: [...SCOPE_ENUM], description: 'Restrict to one layer.' },
      workspaceId: { type: 'string', description: 'Restrict to one workspace.' },
      taskId: { type: 'string', description: 'Restrict to one board task.' },
      limit: { type: 'integer', description: 'Maximum results; defaults to the configured retrieval limit.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          records: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                scope: { type: 'string', required: true, enum: [...SCOPE_ENUM] },
                text: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.records.length === 0
          ? 'No matching memories.'
          : value.records.map(record => `- [${record.scope}] ${record.text}`).join('\n'),
      }],
    },
    async execute(args) {
      const hits = await memory.recall({
        text: args.query,
        tags: args.tags,
        scope: args.scope as MemoryScope | undefined,
        workspaceId: args.workspaceId,
        taskId: args.taskId,
        limit: args.limit,
      })
      return {
        records: hits.map(hit => ({
          id: hit.record.id,
          scope: hit.record.scope,
          text: hit.record.text,
          tags: [...hit.record.tags],
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Recall', kind: 'other', rawInput: args.query ?? '' }),
  }))

  const forget = ctx.tools.register(defineTool({
    name: 'forget',
    description: 'Soft-delete one memory record by id, keeping an auditable tombstone.',
    parameters: {
      id: { type: 'string', required: true, description: 'The record id returned by `remember` or `recall`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { forgotten: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.forgotten ? 'Memory forgotten.' : 'No such memory.' }],
    },
    async execute(args) {
      return { forgotten: await memory.forget(MemoryId(args.id)) }
    },
    presentCall: () => ({ card: 'generic', title: 'Forget', kind: 'other' }),
  }))

  return () => {
    remember()
    recall()
    forget()
  }
}
