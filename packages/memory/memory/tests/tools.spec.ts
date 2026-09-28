/** Memory tools driven by a scripted mock model through the real agent loop. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it } from 'vitest'
import MemoryStore from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MemoryStore, { databasePath: ':memory:' })
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

function toolResults(log: readonly SessionEvent[]): SessionEvent[] {
  return log.filter(event => event.type === 'tool/result')
}

describe('memory tools through the agent loop', () => {
  it('model calls remember then recall: both tools execute and the fact is retrievable', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'remember', {
        text: 'The queue drains before storage closes.',
        tags: ['shutdown'],
        pinned: true,
      }, 'Recording a durable fact.'),
      textResponse('Remembered.'),
      toolCallResponse('call-2', 'recall', { query: 'queue drains' }, 'Recalling.'),
      textResponse('Found it.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-memory'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'remember the shutdown rule' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'what did we say about shutdown?' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const calls = agent.session.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(calls.map(call => call.data.name)).toEqual(['remember', 'recall'])
    for (const result of toolResults(agent.session.snapshotEvents())) {
      expect(result.type === 'tool/result' && result.data.message.isError).toBe(false)
    }
    const hits = await ctx.memory.recall({ text: 'queue drains' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.record.source.origin).toBe('explicit')
    expect(hits[0]?.record.source.sessionId).toBe('it-memory')
  })

  it('model calls forget: the record leaves recall', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'remember', { text: 'throwaway note about widgets' }, 'Recording.'),
      textResponse('Remembered.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-memory-forget'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'note this' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const hits = await ctx.memory.recall({ text: 'throwaway widgets' })
    expect(hits).toHaveLength(1)
    const id = hits[0]?.record.id
    expect(id).toBeDefined()
    if (id === undefined) throw new Error('expected a remembered record')
    expect(await ctx.memory.forget(id)).toBe(true)
    expect(await ctx.memory.recall({ text: 'throwaway widgets' })).toHaveLength(0)
  })
})
