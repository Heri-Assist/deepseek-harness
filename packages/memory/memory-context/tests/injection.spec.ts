/** Automatic recall driven by a scripted mock model through the real agent loop. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it } from 'vitest'
import MemoryStore from '../../memory/src/index.ts'
import * as MemoryContext from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MemoryStore, { databasePath: ':memory:' })
  await ctx.plugin(MemoryContext, { scopes: ['global'], limit: 3, maxChars: 1000, refreshIntervalMs: 0 })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function injected(log: readonly SessionEvent[]): SessionEvent[] {
  return log.filter(event => event.type === 'user/message' && event.data.source.kind === 'memory-context')
}

describe('memory-context automatic recall through the agent loop', () => {
  it('injects a matching saved fact as a durable user message and deduplicates it', async () => {
    const adapter = new MockAdapter([textResponse('Done.'), textResponse('Done again.')])
    const ctx = await harness(adapter)
    await ctx.memory.remember({ text: 'The release command is pnpm release.', tags: ['release'], source: { origin: 'explicit' } })
    const agent = await ctx.agentLoop.create(SessionId('it-memory-context'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'How do I release the project?' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const first = injected(agent.session.snapshotEvents())
    expect(first).toHaveLength(1)
    const message = first[0]
    if (message === undefined || message.type !== 'user/message') throw new Error('expected an injected user message')
    const texts = message.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(texts.join('\n')).toContain('pnpm release')

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'How do I release again?' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(injected(agent.session.snapshotEvents())).toHaveLength(1)
  })

  it('injects nothing when no saved fact matches', async () => {
    const adapter = new MockAdapter([textResponse('Done.')])
    const ctx = await harness(adapter)
    await ctx.memory.remember({ text: 'The release command is pnpm release.', source: { origin: 'explicit' } })
    const agent = await ctx.agentLoop.create(SessionId('it-memory-context-miss'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'What is the weather?' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(injected(agent.session.snapshotEvents())).toHaveLength(0)
  })

  it('skips a message with no content terms', async () => {
    const adapter = new MockAdapter([textResponse('Done.'), textResponse('Again.')])
    const ctx = await harness(adapter)
    await ctx.memory.remember({ text: 'The release command is pnpm release.', source: { origin: 'explicit' } })
    const agent = await ctx.agentLoop.create(SessionId('it-memory-context-terms'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'the and of' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '!!! ???' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(injected(agent.session.snapshotEvents())).toHaveLength(0)
  })

  it('honors the refresh interval and the record limit', async () => {
    const adapter = new MockAdapter([textResponse('Done.'), textResponse('Again.'), textResponse('Third.')])
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(MemoryStore, { databasePath: ':memory:' })
    await ctx.plugin(MemoryContext, { scopes: ['global'], limit: 1, maxChars: 1000, refreshIntervalMs: 600_000 })
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.memory.remember({ text: 'alpha release note', source: { origin: 'explicit' } })
    await ctx.memory.remember({ text: 'alpha deploy note', source: { origin: 'explicit' } })
    const agent = await ctx.agentLoop.create(SessionId('it-memory-context-refresh'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'alpha release' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const first = injected(agent.session.snapshotEvents())
    expect(first).toHaveLength(1)
    const message = first[0]
    if (message === undefined || message.type !== 'user/message') throw new Error('expected an injected message')
    expect(message.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])[0]?.split('\n')).toHaveLength(2)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'alpha deploy' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(injected(agent.session.snapshotEvents())).toHaveLength(1)
  })

  it('returns the decision unchanged when another pre-step listener rejects', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    await ctx.memory.remember({ text: 'alpha release note', source: { origin: 'explicit' } })
    const agent = await ctx.agentLoop.create(SessionId('it-memory-context-reject'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => subject === agent ? { kind: 'reject' as const } : next())
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'alpha release' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(injected(agent.session.snapshotEvents())).toHaveLength(0)
  })

  it('ranks multiple matches and stops at the character budget', async () => {
    const adapter = new MockAdapter([textResponse('Done.')])
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(MemoryStore, { databasePath: ':memory:' })
    await ctx.plugin(MemoryContext, { scopes: ['global'], limit: 2, maxChars: 20, refreshIntervalMs: 0 })
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.memory.remember({ text: 'alpha release note one', source: { origin: 'explicit' } })
    await ctx.memory.remember({ text: 'alpha release note two', source: { origin: 'explicit' } })
    const agent = await ctx.agentLoop.create(SessionId('it-memory-context-budget'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'alpha release' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const first = injected(agent.session.snapshotEvents())
    expect(first).toHaveLength(1)
    const message = first[0]
    if (message === undefined || message.type !== 'user/message') throw new Error('expected an injected message')
    expect(message.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])[0]?.split('\n')).toHaveLength(2)
  })
})
