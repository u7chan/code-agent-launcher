import { describe, expect, it } from 'bun:test'
import type { AgentConfig } from './config.js'
import {
  isProviderModel,
  ModelError,
  normalizeAgentModelId,
  normalizeModelId,
  stripProvider,
} from './model.js'

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    bin: 'opencode',
    provider: 'opencode-go',
    ...overrides,
  }
}

describe('normalizeModelId', () => {
  it('adds provider prefix to short ids', () => {
    expect(normalizeModelId('kimi-k2.7-code', 'opencode-go')).toBe('opencode-go/kimi-k2.7-code')
  })

  it('keeps full ids unchanged', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4-5', 'opencode-go')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
  })

  it('trims model ids before normalizing them', () => {
    expect(normalizeModelId('  gpt-5.6-sol  ', 'codex')).toBe('codex/gpt-5.6-sol')
  })

  it('rejects empty ids', () => {
    expect(() => normalizeModelId('', 'opencode-go')).toThrow(ModelError)
    expect(() => normalizeModelId('   ', 'opencode-go')).toThrow('model id is empty')
  })
})

describe('normalizeAgentModelId', () => {
  it('adds a provider prefix by default', () => {
    expect(normalizeAgentModelId('deepseek-v4-pro', makeAgent())).toBe(
      'opencode-go/deepseek-v4-pro',
    )
  })

  it('keeps raw model IDs for agents that disable provider prefixes', () => {
    expect(
      normalizeAgentModelId(
        'gpt-5.6-sol',
        makeAgent({ bin: 'codex', provider: 'codex', model_id_prefix: false }),
      ),
    ).toBe('gpt-5.6-sol')
  })

  it('removes the agent provider prefix when prefixes are disabled', () => {
    expect(
      normalizeAgentModelId(
        'codex/gpt-5.6-sol',
        makeAgent({ bin: 'codex', provider: 'codex', model_id_prefix: false }),
      ),
    ).toBe('gpt-5.6-sol')
  })

  it('keeps a model from another provider unchanged when prefixes are disabled', () => {
    expect(
      normalizeAgentModelId(
        'anthropic/claude-sonnet-4-5',
        makeAgent({ bin: 'codex', provider: 'codex', model_id_prefix: false }),
      ),
    ).toBe('anthropic/claude-sonnet-4-5')
  })

  it('rejects empty ids', () => {
    expect(() => normalizeAgentModelId('', makeAgent())).toThrow(ModelError)
  })
})

describe('stripProvider', () => {
  it('strips the known provider prefix', () => {
    expect(stripProvider('opencode-go/deepseek-v4-pro', 'opencode-go')).toBe('deepseek-v4-pro')
  })

  it('keeps another provider prefix intact', () => {
    expect(stripProvider('anthropic/claude-sonnet-4-5', 'opencode-go')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
  })

  it('returns an unprefixed model as-is', () => {
    expect(stripProvider('deepseek-v4-pro', 'opencode-go')).toBe('deepseek-v4-pro')
  })
})

describe('isProviderModel', () => {
  it('returns true for a provider-prefixed model', () => {
    expect(isProviderModel('opencode-go/deepseek-v4-pro', 'opencode-go')).toBe(true)
  })

  it('returns false for another provider prefix', () => {
    expect(isProviderModel('anthropic/claude-sonnet-4-5', 'opencode-go')).toBe(false)
  })

  it('returns false for a short model id', () => {
    expect(isProviderModel('deepseek-v4-pro', 'opencode-go')).toBe(false)
  })
})
