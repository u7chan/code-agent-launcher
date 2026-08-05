import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import type { Config } from './config.js'
import { createModelsCommand, formatConfiguredModels } from './models.js'

function makeMultiAgentConfig(): Config {
  return {
    default_agent: 'codex',
    default_profile: 'balanced',
    agents: {
      codex: {
        bin: 'codex',
        provider: 'codex',
        model_id_prefix: false,
      },
      'opencode-go': {
        bin: 'opencode',
        provider: 'opencode-go',
      },
    },
    profiles: {
      fast: { agent: 'codex', model: 'gpt-5.6-luna' },
      balanced: { agent: 'codex', model: 'gpt-5.6-terra' },
      frontier: { agent: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      'opencode-fast': { agent: 'opencode-go', model: 'deepseek-v4-flash' },
      'opencode-balanced': { agent: 'opencode-go', model: 'deepseek-v4-pro' },
      'opencode-frontier': {
        agent: 'opencode-go',
        model: 'kimi-k2.7-code',
        effort: 'xhigh',
      },
    },
    multiplexer: {
      default: 'herdr',
      herdr: { enabled: true },
    },
  }
}

describe('models JSON output', () => {
  it('outputs configured agents and profiles without level fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cagent-models-json-test-'))
    const file = join(dir, 'config.yaml')
    writeFileSync(
      file,
      `default_agent: codex
default_profile: balanced
agents:
  codex:
    bin: node
    provider: codex
    model_id_prefix: false
profiles:
  balanced:
    agent: codex
    model: gpt-5
multiplexer:
  default: herdr
  herdr: { enabled: true }
`,
    )
    const originalConfig = process.env.CAGENT_CONFIG
    process.env.CAGENT_CONFIG = file
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const program = new Command().option('--json')
      program.addCommand(createModelsCommand())
      await program.parseAsync(['node', 'cagent', '--json', 'models', '--refresh'])
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).not.toHaveBeenCalled()
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
      expect(output.schema_version).toBe(1)
      expect(output.ok).toBe(true)
      expect(output.operation).toBe('models')
      expect(output.data.default_agent).toBe('codex')
      expect(output.data.default_profile).toBe('balanced')
      expect(output.data.agents[0]).toEqual({
        id: 'codex',
        provider: 'codex',
        bin: 'node',
        model_id_prefix: false,
      })
      expect(output.data.profiles).toEqual([{ name: 'balanced', agent: 'codex', model: 'gpt-5' }])
      expect(Object.hasOwn(output.data, 'default_level')).toBe(false)
      expect(Object.hasOwn(output.data.agents[0], 'levels')).toBe(false)
      expect(output.warnings).toHaveLength(1)
      expect(output.warnings[0].code).toBe('REFRESH_IGNORED')
      expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('Agent:')
    } finally {
      warnSpy.mockRestore()
      logSpy.mockRestore()
      if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = originalConfig
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('formatConfiguredModels', () => {
  it('displays all agents and their profiles when no filter is set', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig())
    expect(output).toContain('Agent: codex (default)')
    expect(output).toContain('Agent: opencode-go')
    expect(output).toContain('Default profile: balanced')
    expect(output).toContain('PROFILE')
    expect(output).toContain('MODEL')
    expect(output).toContain('EFFORT')
    expect(output).toContain('gpt-5.6-luna')
    expect(output).toContain('gpt-5.6-sol')
    expect(output).toContain('deepseek-v4-flash')
    expect(output).toContain('kimi-k2.7-code')
    expect(output).not.toContain('LEVEL')
    expect(output).not.toContain('ALLOWED MODELS')
  })

  it('filters profiles with the selected agent', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig(), 'codex')
    expect(output).toContain('Agent: codex (default)')
    expect(output).not.toContain('Agent: opencode-go')
    expect(output).toContain('gpt-5.6-terra')
    expect(output).not.toContain('deepseek-v4-pro')
  })

  it('shows an error for a non-existent agent filter', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig(), 'nonexistent')
    expect(output).toContain('Error: agent "nonexistent" is not defined in config')
  })

  it('shows the configured default agent label', () => {
    const config = makeMultiAgentConfig()
    config.default_agent = 'opencode-go'
    const output = formatConfiguredModels(config)
    expect(output).toContain('Agent: opencode-go (default)')
    expect(output).toContain('Agent: codex')
    expect(output).not.toContain('Agent: codex (default)')
  })

  it('handles an agent with no profiles', () => {
    const config = makeMultiAgentConfig()
    config.profiles = {
      balanced: { agent: 'codex', model: 'gpt-5.6-terra' },
    }
    const output = formatConfiguredModels(config, 'opencode-go')
    expect(output).toContain('Profiles: (none defined)')
  })
})
