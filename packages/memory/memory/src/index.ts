/**
 * Durable Host-wide memory store with layered scopes and FTS5 text recall.
 *
 * @module @deepseek-ai/dsh-memory
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { openMemoryDatabase } from './schema.ts'
import { registerMemoryTools } from './tools.ts'
import { MemoryId as toMemoryId, MemoryInputError, MEMORY_SCOPES, type MemoryId } from './types.ts'
import type {
  MemoryHit,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  RememberInput,
} from './types.ts'

export type * from './types.ts'
export { MemoryId, MemoryInputError, MEMORY_SCOPES } from './types.ts'
export {
  MEMORY_APPLICATION_ID,
  MEMORY_SCHEMA_VERSION,
  openMemoryDatabase,
} from './schema.ts'
export { registerMemoryTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable Host-wide layered memory. */
    memory: MemoryStore
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A memory record was written, updated, or forgotten; clients refetch.
     * @mode emit
     */
    'memory/changed'(): void
  }
}

/** Memory-store configuration. */
export interface Config {
  /** Store path; omission uses `$DSH_HOME/memory/memory.sqlite`. */
  databasePath?: string
  /** Retained unpinned records per scope; the oldest are evicted past this cap. */
  maxRecordsPerScope?: number
  /** Default result count for `recall` and `search`. */
  retrievalLimit?: number
  /** Maximum accepted record text length in UTF-8 bytes. */
  maxTextBytes?: number
}

/** Retained unpinned records per scope applied when the deployment states none. */
export const DEFAULT_MAX_RECORDS_PER_SCOPE = 2000
/** Default result count applied when the deployment states none. */
export const DEFAULT_RETRIEVAL_LIMIT = 5
/** Maximum accepted record text length applied when the deployment states none. */
export const DEFAULT_MAX_TEXT_BYTES = 8192

/** Schemastery configuration for the memory service. */
export const Config: z<Config> = z.object({
  databasePath: z.string().min(1),
  maxRecordsPerScope: z.number().step(1).min(1).max(100_000).default(DEFAULT_MAX_RECORDS_PER_SCOPE),
  retrievalLimit: z.number().step(1).min(1).max(100).default(DEFAULT_RETRIEVAL_LIMIT),
  maxTextBytes: z.number().step(1).min(1).max(1_000_000).default(DEFAULT_MAX_TEXT_BYTES),
})

/** One raw `memories` row as SQLite returns it. */
interface MemoryRow {
  id: string
  scope: string
  workspace_id: string | null
  task_id: string | null
  key: string | null
  text: string
  tags: string
  source: string
  pinned: number
  supersedes: string | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  use_count: number
  rank?: number
}

/**
 * Resolve the scope and owning ids of one write, rejecting an inconsistent pair.
 * @param input - the caller's write input.
 * @returns the resolved scope and owning ids.
 */
function resolveScope(input: RememberInput): { scope: MemoryScope; workspaceId?: string; taskId?: string } {
  const scope = input.scope ?? 'global'
  if (!MEMORY_SCOPES.includes(scope)) throw new MemoryInputError(`unknown memory scope ${JSON.stringify(scope)}`)
  if (scope === 'global') return { scope }
  if (input.workspaceId === undefined || input.workspaceId.length === 0) {
    throw new MemoryInputError(`memory scope ${scope} requires a workspaceId`)
  }
  if (scope === 'project') return { scope, workspaceId: input.workspaceId }
  if (input.taskId === undefined || input.taskId.length === 0) {
    throw new MemoryInputError('memory scope task requires a taskId')
  }
  return { scope, workspaceId: input.workspaceId, taskId: input.taskId }
}

/**
 * Quote one query term as an inert FTS5 phrase.
 * @param term - a single alphanumeric token.
 * @returns the quoted phrase.
 */
function quoteTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`
}

/**
 * Build an FTS5 MATCH expression from caller text, or undefined when the text
 * carries no searchable token.
 * @param text - caller-supplied query text.
 * @returns the MATCH expression, or undefined.
 */
export function buildMatchExpression(text: string): string | undefined {
  const tokens = text.match(/[\p{L}\p{N}_]+/gu)
  if (tokens === null || tokens.length === 0) return undefined
  return tokens.map(quoteTerm).join(' AND ')
}

/** SQLite output value union accepted from a query row. */
type SqlValue = string | number | bigint | null | Uint8Array

function readRequiredString(row: Record<string, SqlValue>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`memory: column ${key} must be text`)
  return value
}

function readOptionalString(row: Record<string, SqlValue>, key: string): string | null {
  const value = row[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`memory: column ${key} must be text or null`)
  return value
}

function readRequiredNumber(row: Record<string, SqlValue>, key: string): number {
  const value = row[key]
  if (typeof value !== 'number') throw new Error(`memory: column ${key} must be numeric`)
  return value
}

function readOptionalNumber(row: Record<string, SqlValue>, key: string): number | undefined {
  const value = row[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number') throw new Error(`memory: column ${key} must be numeric`)
  return value
}

/**
 * Convert one raw SQLite row into a {@link MemoryRow}, rejecting an unexpected column type.
 * @param row - the raw row as `node:sqlite` returns it.
 * @returns the typed row.
 */
function toMemoryRow(row: Record<string, SqlValue>): MemoryRow {
  const rank = readOptionalNumber(row, 'rank')
  return {
    id: readRequiredString(row, 'id'),
    scope: readRequiredString(row, 'scope'),
    workspace_id: readOptionalString(row, 'workspace_id'),
    task_id: readOptionalString(row, 'task_id'),
    key: readOptionalString(row, 'key'),
    text: readRequiredString(row, 'text'),
    tags: readRequiredString(row, 'tags'),
    source: readRequiredString(row, 'source'),
    pinned: readRequiredNumber(row, 'pinned'),
    supersedes: readOptionalString(row, 'supersedes'),
    created_at: readRequiredString(row, 'created_at'),
    updated_at: readRequiredString(row, 'updated_at'),
    last_used_at: readOptionalString(row, 'last_used_at'),
    use_count: readRequiredNumber(row, 'use_count'),
    ...rank === undefined ? {} : { rank },
  }
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  const record: MemoryRecord = {
    id: toMemoryId(row.id),
    scope: row.scope as MemoryScope,
    tags: JSON.parse(row.tags) as string[],
    text: row.text,
    source: JSON.parse(row.source) as MemoryRecord['source'],
    pinned: row.pinned !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    useCount: row.use_count,
    ...row.workspace_id === null ? {} : { workspaceId: row.workspace_id },
    ...row.task_id === null ? {} : { taskId: row.task_id },
    ...row.key === null ? {} : { key: row.key },
    ...row.supersedes === null ? {} : { supersedes: toMemoryId(row.supersedes) },
    ...row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at },
  }
  return record
}

/**
 * Durable, Host-wide layered memory. Writes and reads are independent of any
 * Session; source links each record to the work that produced it.
 */
export class MemoryStore extends Service {
  static inject = ['tools']

  static Config: z<Config> = Config

  private readonly databasePath: string
  private readonly maxRecordsPerScope: number
  private readonly retrievalLimit: number
  private readonly maxTextBytes: number
  private readonly ready: Promise<DatabaseSync>

  /**
   * @param ctx - Host context carrying the tool registry.
   * @param config - validated store configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'memory')
    this.databasePath = config.databasePath ?? dshHomePath('memory', 'memory.sqlite')
    this.maxRecordsPerScope = config.maxRecordsPerScope ?? DEFAULT_MAX_RECORDS_PER_SCOPE
    this.retrievalLimit = config.retrievalLimit ?? DEFAULT_RETRIEVAL_LIMIT
    this.maxTextBytes = config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES
    this.ready = openMemoryDatabase(this.databasePath)
    ctx.effect(() => async () => {
      const db = await this.ready
      db.close()
    })
    ctx.effect(() => registerMemoryTools(ctx, this))
  }

  /**
   * Persist one fact.
   * @param input - the fact, its scope, and its source.
   * @returns the stored record.
   * @throws {@link MemoryInputError} when the input violates a store constraint.
   */
  async remember(input: RememberInput): Promise<MemoryRecord> {
    const text = input.text.trim()
    if (text.length === 0) throw new MemoryInputError('memory text must be non-empty')
    if (Buffer.byteLength(text, 'utf8') > this.maxTextBytes) {
      throw new MemoryInputError(`memory text exceeds the ${this.maxTextBytes}-byte limit`)
    }
    const { scope, workspaceId, taskId } = resolveScope(input)
    const key = input.key?.trim()
    if (key !== undefined && key.length === 0) throw new MemoryInputError('memory key must be non-empty when present')
    const tags = [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(tag => tag.length > 0))]
    const now = new Date().toISOString()
    const record: MemoryRecord = {
      id: toMemoryId(randomUUID()),
      scope,
      tags,
      text,
      source: input.source,
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      ...workspaceId === undefined ? {} : { workspaceId },
      ...taskId === undefined ? {} : { taskId },
      ...key === undefined ? {} : { key },
    }
    const db = await this.ready
    db.prepare(`
      INSERT INTO memories
        (id, scope, workspace_id, task_id, key, text, tags, source, pinned, created_at, updated_at, use_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.scope, workspaceId ?? null, taskId ?? null, key ?? null, text,
      JSON.stringify(tags), JSON.stringify(input.source), record.pinned ? 1 : 0, now, now, 0,
    )
    db.prepare('INSERT INTO memories_fts (id, text, tags) VALUES (?, ?, ?)').run(record.id, text, tags.join(' '))
    await this.evictScope(db, record.scope, workspaceId, taskId)
    this.emitChanged()
    return record
  }

  /**
   * Search records and mark every returned record as used.
   * @param query - text, tag, and scope filters.
   * @returns ranked hits.
   */
  async recall(query: MemoryQuery): Promise<MemoryHit[]> {
    const hits = await this.search(query)
    if (hits.length > 0) {
      const db = await this.ready
      const now = new Date().toISOString()
      const update = db.prepare('UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
      for (const hit of hits) update.run(now, hit.record.id)
    }
    return hits
  }

  /**
   * Search records without marking them used.
   * @param query - text, tag, and scope filters.
   * @returns ranked hits.
   */
  async search(query: MemoryQuery): Promise<MemoryHit[]> {
    const db = await this.ready
    const limit = query.limit ?? this.retrievalLimit
    const where: string[] = ['m.deleted = 0']
    const params: Array<string | number> = []
    if (query.scope !== undefined) {
      where.push('m.scope = ?')
      params.push(query.scope)
    }
    if (query.workspaceId !== undefined) {
      where.push('m.workspace_id = ?')
      params.push(query.workspaceId)
    }
    if (query.taskId !== undefined) {
      where.push('m.task_id = ?')
      params.push(query.taskId)
    }
    const match = query.text === undefined ? undefined : buildMatchExpression(query.text)
    let rows: MemoryRow[]
    if (match === undefined) {
      rows = db.prepare(`
        SELECT m.*, 0 AS rank FROM memories m
        WHERE ${where.join(' AND ')}
        ORDER BY m.updated_at DESC
        LIMIT ?
      `).all(...params, limit).map(toMemoryRow)
    } else {
      rows = db.prepare(`
        SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts
        JOIN memories m ON m.id = memories_fts.id
        WHERE memories_fts MATCH ? AND ${where.join(' AND ')}
        ORDER BY rank
        LIMIT ?
      `).all(match, ...params, limit).map(toMemoryRow)
    }
    const required = query.tags ?? []
    return rows
      .filter(row => required.every(tag => (JSON.parse(row.tags) as string[]).includes(tag)))
      .map(row => ({ record: rowToRecord(row), rank: row.rank ?? 0 }))
  }

  /**
   * Soft-delete one record, keeping an auditable tombstone.
   * @param id - the record identity.
   * @returns true when an active record was forgotten.
   */
  async forget(id: MemoryId): Promise<boolean> {
    const db = await this.ready
    const now = new Date().toISOString()
    const result = db.prepare('UPDATE memories SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0').run(now, id)
    if (result.changes === 0) return false
    db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id)
    this.emitChanged()
    return true
  }

  /**
   * List active records, newest first.
   * @param query - optional scope filters.
   * @returns the matching records.
   */
  async list(query: MemoryQuery = {}): Promise<MemoryRecord[]> {
    const hits = await this.search({
      ...query.scope === undefined ? {} : { scope: query.scope },
      ...query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId },
      ...query.taskId === undefined ? {} : { taskId: query.taskId },
      ...query.tags === undefined ? {} : { tags: query.tags },
      ...query.limit === undefined ? {} : { limit: query.limit },
    })
    return hits.map(hit => hit.record)
  }

  /** Evict the oldest unpinned records in one scope past the configured cap. */
  private async evictScope(
    db: DatabaseSync,
    scope: MemoryScope,
    workspaceId: string | undefined,
    taskId: string | undefined,
  ): Promise<void> {
    const rows = db.prepare(`
      SELECT id FROM memories
      WHERE scope = ? AND deleted = 0 AND pinned = 0
        AND (workspace_id IS ?) AND (task_id IS ?)
      ORDER BY updated_at DESC, rowid DESC
      LIMIT -1 OFFSET ?
    `).all(scope, workspaceId ?? null, taskId ?? null, this.maxRecordsPerScope) as Array<{ id: string }>
    if (rows.length === 0) return
    const remove = db.prepare('DELETE FROM memories WHERE id = ?')
    const removeFts = db.prepare('DELETE FROM memories_fts WHERE id = ?')
    for (const row of rows) {
      remove.run(row.id)
      removeFts.run(row.id)
    }
  }

  /** Notify listeners after a committed mutation. */
  private emitChanged(): void {
    try {
      this.ctx.emit('memory/changed')
    } catch (error: unknown) {
      this.ctx.logger.warn(`memory: memory/changed listener failed: ${String(error)}`)
    }
  }
}

export default MemoryStore
