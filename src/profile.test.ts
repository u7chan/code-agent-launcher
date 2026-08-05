import { describe, expect, it } from 'bun:test'
import type { Config } from './config.js'
import { ProfileError, resolveProfile } from './profile.js'

function makeConfig(): Config {
  return {
    default_agent: 'opencode-go',
    default_level: 'mid',
    default_profile: 'balanced',
    agents: {
      'opencode-go': {
        bin: 'opencode',
        provider: 'opencode-go',
        levels: {
          mid: {
            description: 'Normal tasks',
            default_model: 'deepseek-v4-pro',
            models: ['deepseek-v4-pro'],
          },
        },
      },
      codex: {
        bin: 'codex',
        provider: 'codex',
        model_id_prefix: false,
        levels: {
          high: {
            description: 'Complex tasks',
            default_model: 'gpt-5.6-sol',
            models: ['gpt-5.6-sol'],
          },
        },
      },
    },
    profiles: {
      fast: { agent: 'opencode-go', model: 'deepseek-v4-flash', effort: 'low' },
      balanced: { agent: 'opencode-go', model: 'deepseek-v4-pro' },
      frontier: { agent: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    },
    multiplexer: {
      default: 'herdr',
      herdr: { enabled: true },
    },
  }
}

describe('resolveProfile', () => {
  it('uses default_profile when nothing is specified', () => {
    const result = resolveProfile(makeConfig(), {})
    expect(result).toEqual({
      profile: 'balanced',
      source: 'default',
      agent: 'opencode-go',
      model: 'deepseek-v4-pro',
      modelSource: 'profile',
    })
  })

  it('resolves a profile that spans a different agent', () => {
    const result = resolveProfile(makeConfig(), { cliProfile: 'frontier' })
    expect(result.profile).toBe('frontier')
    expect(result.agent).toBe('codex')
    expect(result.model).toBe('gpt-5.6-sol')
    expect(result.effort).toBe('xhigh')
    expect(result.effortSource).toBe('profile')
  })

  it('prioritizes CLI profile over env profile', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: 'fast',
      envProfile: 'frontier',
    })
    expect(result.profile).toBe('fast')
    expect(result.source).toBe('cli')
    expect(result.agent).toBe('opencode-go')
  })

  it('falls back to env profile over default_profile', () => {
    const result = resolveProfile(makeConfig(), { envProfile: 'frontier' })
    expect(result.profile).toBe('frontier')
    expect(result.source).toBe('env')
    expect(result.agent).toBe('codex')
  })

  it('throws for an unknown profile with the available list', () => {
    expect(() => resolveProfile(makeConfig(), { cliProfile: 'nope' })).toThrow(ProfileError)
    expect(() => resolveProfile(makeConfig(), { cliProfile: 'nope' })).toThrow(
      'unknown profile: nope',
    )
    expect(() => resolveProfile(makeConfig(), { cliProfile: 'nope' })).toThrow(
      'Available profiles:',
    )
    expect(() => resolveProfile(makeConfig(), { cliProfile: 'nope' })).toThrow('  balanced')
  })

  it('throws when no profile is selected and no default is configured', () => {
    const config = makeConfig()
    config.default_profile = undefined
    expect(() => resolveProfile(config, {})).toThrow(ProfileError)
    expect(() => resolveProfile(config, {})).toThrow('no launch profile selected')
    expect(() => resolveProfile(config, {})).toThrow('Available profiles:')
  })

  it('reports an empty available list when no profiles are defined', () => {
    const config = makeConfig()
    config.profiles = undefined
    config.default_profile = undefined
    expect(() => resolveProfile(config, {})).toThrow('(none defined)')
  })

  it('prioritizes CLI model over env model and profile model', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: 'balanced',
      cliModel: 'custom-cli-model',
      envModel: 'custom-env-model',
    })
    expect(result.model).toBe('custom-cli-model')
    expect(result.modelSource).toBe('cli')
  })

  it('falls back to env model over the profile model', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: 'balanced',
      envModel: 'custom-env-model',
    })
    expect(result.model).toBe('custom-env-model')
    expect(result.modelSource).toBe('env')
  })

  it('keeps the profile effort when only the model is overridden', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: 'fast',
      cliModel: 'custom-model',
    })
    expect(result.model).toBe('custom-model')
    expect(result.modelSource).toBe('cli')
    expect(result.effort).toBe('low')
    expect(result.effortSource).toBe('profile')
  })

  it('prioritizes CLI effort over env effort and profile effort', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: 'fast',
      cliEffort: 'custom-cli-effort',
      envEffort: 'custom-env-effort',
    })
    expect(result.effort).toBe('custom-cli-effort')
    expect(result.effortSource).toBe('cli')
  })

  it('falls back to env effort over the profile effort', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: 'fast',
      envEffort: 'custom-env-effort',
    })
    expect(result.effort).toBe('custom-env-effort')
    expect(result.effortSource).toBe('env')
  })

  it('resolves no effort for a profile without effort', () => {
    const result = resolveProfile(makeConfig(), { cliProfile: 'balanced' })
    expect(result.effort).toBeUndefined()
    expect(result.effortSource).toBeUndefined()
  })

  it('treats empty string overrides as unset', () => {
    const result = resolveProfile(makeConfig(), {
      cliProfile: '',
      envProfile: '',
      cliModel: '',
      envModel: '',
      cliEffort: '',
      envEffort: '',
    })
    expect(result.profile).toBe('balanced')
    expect(result.source).toBe('default')
    expect(result.model).toBe('deepseek-v4-pro')
    expect(result.modelSource).toBe('profile')
    expect(result.effort).toBeUndefined()
    expect(result.effortSource).toBeUndefined()
  })
})
