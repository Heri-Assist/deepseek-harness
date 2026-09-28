/**
 * Automatic memory recall. An eligible step searches durable memory with the
 * text already entering the request and appends the best-matching facts as a
 * durable, source-attributed user message, so what the model receives is
 * reconstructable from the session log.
 *
 * @module @deepseek-ai/dsh-memory-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryHit, MemoryScope } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Recalled memory attribution; readers preserve the content without this producer.
     * The id list lets the projection avoid re-injecting a record.
     * @persistenceAttribution
     */
    'memory-context': { kind: 'memory-context'; ids: readonly string[] } & ContextFormed
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Records already injected into this session, and the last injection instant. */
    memoryContext: MemoryContextProjection
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'memory-context'

/** Required services: the memory store, the agent loop event, and the projection registry. */
export const inject = ['memory', 'agents', 'sessionProjections']

/** Every scope a deployment may make eligible for automatic injection. */
const SCOPES: readonly MemoryScope[] = ['global', 'project', 'task']

/** Bound on the per-session list of injected record ids retained for deduplication. */
const INJECTED_ID_CAP = 500

/** Common words dropped from the automatic query so recall keys on content terms. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'that', 'this', 'from',
  'have', 'has', 'had', 'was', 'were', 'will', 'would', 'can', 'could', 'should', 'what',
  'when', 'where', 'which', 'who', 'how', 'why', 'is', 'am', 'do', 'does', 'did', 'of',
  'to', 'in', 'on', 'at', 'by', 'or', 'as', 'it', 'its', 'be', 'been', 'being', 'my',
  'me', 'we', 'our', 'they', 'them', 'their', 'he', 'she', 'him', 'her', 'his', 'a', 'an',
])

const memoryContextStateSchema = zod.object({
  /** Ids already injected in this session, oldest first. */
  injectedIds: zod.array(zod.string()),
  /** Instant of the latest injection, or null before the first. */
  lastInjectionTime: zod.number().nullable(),
})

/** Folded recall state for one session. */
type MemoryContextProjection = zod.infer<typeof memoryContextStateSchema>

/** Automatic recall configuration. Invalid values fail plugin load. */
export interface Config {
  /** Scopes searched for automatic injection; defaults to `['global']`. */
  scopes?: MemoryScope[]
  /** Maximum records appended in one step; defaults to 3. */
  limit?: number
  /** Maximum total characters appended in one step; defaults to 2000. */
  maxChars?: number
  /** Minimum milliseconds between injections in one session; 0 injects at every eligible step; defaults to 0. */
  refreshIntervalMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  scopes: z.array(z.union([z.const('global'), z.const('project'), z.const('task')])).default(['global']),
  limit: z.number().step(1).min(1).max(20).default(3),
  maxChars: z.number().step(1).min(1).max(20_000).default(2000),
  refreshIntervalMs: z.number().step(1).min(0).max(86_400_000).default(0),
})

/** Extract the text the request would carry, joined in order. */
function messageText(messages: readonly UserMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/**
 * Build the automatic query from content terms only: drop stopwords and very
 * short tokens so a common word in the incoming message does not match every
 * saved fact.
 * @param text - the text entering the request.
 * @returns space-joined content terms, or an empty string when none remain.
 */
function queryTerms(text: string): string {
  const tokens = text.match(/[\p{L}\p{N}_]+/gu) ?? []
  return tokens
    .filter(token => token.length >= 3 && !STOPWORDS.has(token.toLowerCase()))
    .join(' ')
}

/** Render the injected message body from ranked records within the character budget. */
function renderRecords(hits: readonly MemoryHit[], maxChars: number): { text: string; ids: string[] } | undefined {
  const lines: string[] = []
  const ids: string[] = []
  let used = 0
  for (const hit of hits) {
    const line = `- [${hit.record.scope}] ${hit.record.text}`
    if (used + line.length > maxChars && lines.length > 0) break
    lines.push(line)
    ids.push(hit.record.id)
    used += line.length + 1
  }
  if (lines.length === 0) return undefined
  return {
    text: 'Saved memories possibly relevant here (notes from earlier sessions; verify before relying on them):\n'
      + lines.join('\n'),
    ids,
  }
}

/**
 * Register the recall pre-step listener and its dedup projection for the
 * lifetime of `ctx`.
 * @param ctx - plugin context; both registrations are disposed with it.
 * @param config - eligible scopes and injection bounds.
 * @throws when a configured scope is unknown.
 */
export function apply(ctx: Context, config: Config): void {
  const scopes = config.scopes ?? ['global']
  for (const scope of scopes) {
    if (!SCOPES.includes(scope)) throw new TypeError(`memory-context: unknown scope ${JSON.stringify(scope)}`)
  }
  const limit = config.limit ?? 3
  const maxChars = config.maxChars ?? 2000
  const refreshIntervalMs = config.refreshIntervalMs ?? 0

  ctx.sessionProjections.register({
    key: 'memoryContext',
    stateVersion: 1,
    stateSchema: memoryContextStateSchema,
    init: () => ({ injectedIds: [], lastInjectionTime: null }),
    apply: (state, event) => {
      if (event.type === 'user/message' && event.data.source.kind === name) {
        const merged = [...new Set([...state.injectedIds, ...event.data.source.ids])]
        return {
          injectedIds: merged.slice(-INJECTED_ID_CAP),
          lastInjectionTime: event.time,
        }
      }
      return state
    },
  })

  ctx.on('agent/pre-step', async (
    { agent, signal }: { agent: Agent; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const text = messageText(decision.messages)
    const query = queryTerms(text)
    if (query.length === 0) return decision
    const state = ctx.sessionProjections.stateOf(agent.session, 'memoryContext') as MemoryContextProjection
    if (refreshIntervalMs > 0 && state.lastInjectionTime !== null
      && Date.now() - state.lastInjectionTime < refreshIntervalMs) return decision
    const seen = new Set(state.injectedIds)
    const hits: MemoryHit[] = []
    for (const scope of scopes) {
      const found = await ctx.memory.search({ text: query, scope, limit, match: 'any' })
      for (const hit of found) if (!seen.has(hit.record.id)) hits.push(hit)
    }
    hits.sort((a, b) => a.rank - b.rank)
    const unique: MemoryHit[] = []
    const emitted = new Set<string>()
    for (const hit of hits) {
      if (emitted.has(hit.record.id)) continue
      emitted.add(hit.record.id)
      unique.push(hit)
      if (unique.length >= limit) break
    }
    const rendered = renderRecords(unique, maxChars)
    if (rendered === undefined) return decision
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: rendered.text }],
          source: { kind: name, form: 'recall', ids: rendered.ids },
        }),
      ],
    }
  })
}
