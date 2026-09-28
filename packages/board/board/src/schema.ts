/**
 * Durable board-domain schema: one `tasks` table keyed by task id, with the
 * owning workspace stored on the record.
 *
 * @module @deepseek-ai/dsh-board
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { BOARD_TASK_STATUSES, BoardTaskId } from './types.ts'
import type { BoardTask } from './types.ts'

const assigneeSchema = z.object({
  kind: z.enum(['human', 'agent']),
  sessionId: z.string().min(1).transform(SessionId).optional(),
  label: z.string().min(1).optional(),
}).strict()

/** Durable task value; malformed rows reject opening the domain. */
export const boardTaskSchema = z.object({
  id: z.string().min(1).transform(BoardTaskId),
  workspaceId: z.string().min(1).transform(WorkspaceId),
  revision: z.number().int().nonnegative(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']),
  labels: z.array(z.string().min(1)),
  status: z.enum(BOARD_TASK_STATUSES),
  blockedBy: z.array(z.string().min(1).transform(BoardTaskId)),
  writeScopes: z.array(z.string().min(1)),
  assignee: assigneeSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

/** Authoritative board storage. */
export const boardDomain = defineDomain({
  name: 'board',
  version: 1,
  tables: { tasks: domainTable<BoardTaskId, BoardTask>(boardTaskSchema) },
})
