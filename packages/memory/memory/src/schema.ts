/**
 * SQLite schema for the durable memory store: one `memories` table plus an
 * FTS5 index over text and tags.
 *
 * @module @deepseek-ai/dsh-memory
 */

import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** Current memory-store schema version. A mismatch rebuilds the derived index tables. */
export const MEMORY_SCHEMA_VERSION = 1

/** SQLite application id protecting unrelated databases from memory-store writes. */
export const MEMORY_APPLICATION_ID = 0x4453484d

/** The only user tables the memory store owns; anything else marks a foreign database. */
const MEMORY_USER_TABLES = new Set([
  'memories',
  'memories_fts',
  'memories_fts_data',
  'memories_fts_idx',
  'memories_fts_content',
  'memories_fts_docsize',
  'memories_fts_config',
])

/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files keep their modes, and errors other than `EEXIST` propagate.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ name: string }>
  return rows.map(row => row.name)
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      workspace_id TEXT,
      task_id TEXT,
      key TEXT,
      text TEXT NOT NULL,
      tags TEXT NOT NULL,
      source TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS memories_scope ON memories (scope, workspace_id, task_id);
    CREATE INDEX IF NOT EXISTS memories_key ON memories (scope, workspace_id, task_id, key);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      text,
      tags,
      tokenize = 'unicode61'
    );
  `)
}

/** Drop every owned table so a schema-version bump can rebuild in place. */
function resetSchema(db: DatabaseSync): void {
  db.exec('DROP TABLE IF EXISTS memories; DROP TABLE IF EXISTS memories_fts;')
  ensureSchema(db)
}

/**
 * Open, validate, and initialize the durable memory database.
 * @param path - store path or `:memory:`; missing filesystem paths are created owner-only.
 * @returns initialized database handle owned by the memory service.
 */
export async function openMemoryDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const userTables = listUserTables(db)
    if (applicationId !== 0 && applicationId !== MEMORY_APPLICATION_ID) {
      throw new Error(`memory store at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`memory store at "${actual}" is not empty and not a recognized memory database`)
    }
    const foreign = userTables.filter(name => !MEMORY_USER_TABLES.has(name))
    if (foreign.length > 0) {
      throw new Error(`memory store at "${actual}" holds unknown tables: ${foreign.join(', ')}`)
    }
    if (applicationId === MEMORY_APPLICATION_ID && version !== MEMORY_SCHEMA_VERSION) resetSchema(db)
    db.exec(`PRAGMA application_id = ${String(MEMORY_APPLICATION_ID)}`)
    db.exec(`PRAGMA user_version = ${String(MEMORY_SCHEMA_VERSION)}`)
    ensureSchema(db)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}
