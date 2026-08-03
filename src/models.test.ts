import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from './config.js'
import { runDoctor } from './doctor.js'
import { createMainCommand } from './main.js'
import { createModelsCommand, formatConfiguredModels } from './models.js'

function makeMultiAgentConfig(): Config {
  return {
    default_agent: 'codex',
    default_level: 'mid',
    agents: {
      codex: {
        bin: 'codex',
        provider: 'codex',
        model_id_prefix: false,
        levels: {
          low: {
            description: 'Simple',
            default_model: 'gpt-5.6-luna',
            models: ['gpt-5.6-luna'],
          },
          mid: {
            description: 'Normal',
            default_model: 'gpt-5.6-terra',
            models: ['gpt-5.6-terra'],
          },
          high: {
            description: 'Complex',
            default_model: 'gpt-5.6-sol',
            models: ['gpt-5.6-sol'],
          },
        },
      },
      'opencode-go': {
        bin: 'opencode',
        provider: 'opencode-go',
        levels: {
          low: {
            description: 'Simple',
            default_model: 'deepseek-v4-flash',
            models: ['deepseek-v4-flash'],
          },
          mid: {
            description: 'Normal',
            default_model: 'deepseek-v4-pro',
            models: ['deepseek-v4-pro'],
          },
          high: {
            description: 'Complex',
            default_model: 'kimi-k2.7-code',
            models: ['kimi-k2.7-code'],
          },
        },
      },
    },
    multiplexer: {
      default: 'herdr',
      herdr: { enabled: true },
    },
  }
}

describe('models JSON output', () => {
  it('outputs configured models as JSON without the table', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cagent-models-json-test-'))
    const file = join(dir, 'config.yaml')
    writeFileSync(
      file,
      `default_agent: codex
default_level: mid
agents:
  codex:
    bin: node
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Normal
        default_model: gpt-5
        models: [gpt-5]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`,
    )
    const originalConfig = process.env.CAGENT_CONFIG
    process.env.CAGENT_CONFIG = file
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const command = createMainCommand()
      command.addCommand(createModelsCommand())
      await command.parseAsync(['node', 'cagent', 'models', '--json'])
      expect(logSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
      expect(output.schema_version).toBe(1)
      expect(output.ok).toBe(true)
      expect(output.operation).toBe('models')
      expect(output.data.default_agent).toBe('codex')
      expect(output.data.agents[0]).toMatchObject({
        id: 'codex',
        provider: 'codex',
        bin: 'node',
        model_id_prefix: false,
        default_level: null,
      })
      expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('Agent:')
    } finally {
      logSpy.mockRestore()
      if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = originalConfig
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('formatConfiguredModels', () => {
  it('displays all agents when no filter', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig())
    expect(output).toContain('Agent: codex (default)')
    expect(output).toContain('Agent: opencode-go')
    expect(output).toContain('Default level: mid')
    expect(output).toContain('gpt-5.6-luna')
    expect(output).toContain('gpt-5.6-sol')
    expect(output).toContain('deepseek-v4-flash')
    expect(output).toContain('kimi-k2.7-code')
    expect(output).toContain('LEVEL')
    expect(output).toContain('DEFAULT MODEL')
    expect(output).toContain('ALLOWED MODELS')
  })

  it('filters by agent when agentFilter is specified', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig(), 'codex')
    expect(output).toContain('Agent: codex (default)')
    expect(output).not.toContain('Agent: opencode-go')
    expect(output).toContain('gpt-5.6-terra')
    expect(output).not.toContain('deepseek-v4-pro')
  })

  it('shows error for non-existent agent filter', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig(), 'nonexistent')
    expect(output).toContain('Error: agent "nonexistent" is not defined in config')
  })

  it('shows (default) label on the configured default agent', () => {
    const config = makeMultiAgentConfig()
    config.default_agent = 'opencode-go'
    const output = formatConfiguredModels(config)
    expect(output).toContain('Agent: opencode-go (default)')
    expect(output).toContain('Agent: codex')
    expect(output).not.toContain('Agent: codex (default)')
  })

  it('handles --agent filter with opencode-go', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig(), 'opencode-go')
    expect(output).toContain('Agent: opencode-go')
    expect(output).not.toContain('Agent: codex')
    expect(output).toContain('deepseek-v4-pro')
    expect(output).not.toContain('gpt-5.6-terra')
  })

  it('formats table with proper column alignment', () => {
    const output = formatConfiguredModels(makeMultiAgentConfig(), 'codex')
    const lines = output.split('\n')
    const headerIdx = lines.findIndex((l) => l.includes('LEVEL') && l.includes('DEFAULT MODEL'))
    expect(headerIdx).toBeGreaterThan(-1)
    const lowLine = lines[headerIdx + 1]
    expect(lowLine.trimStart()).toMatch(/^low\s+/)
    const midLine = lines[headerIdx + 2]
    expect(midLine.trimStart()).toMatch(/^mid\s+/)
  })
})

describe('doctor SKIP for unsupported model listing', () => {
  function writeTempConfig(content: string): { file: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'cagent-doctor-test-'))
    const file = join(dir, 'config.yaml')
    writeFileSync(file, content)
    return {
      file,
      cleanup: () => {
        delete process.env.CAGENT_CONFIG
        rmSync(dir, { recursive: true, force: true })
      },
    }
  }

  it('emits SKIP instead of WARN when adapter does not support model listing and binary is available', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
default_level: mid
agents:
  codex:
    bin: node
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Normal
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
multiplexer:
  default: herdr
  herdr: { enabled: true, start_command_template: "s", run_command_template: "r" }
`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const skipResults = results.filter((r) => r.status === 'SKIP')
      expect(skipResults.length).toBeGreaterThanOrEqual(1)
      expect(skipResults.some((r) => r.message.includes('does not support model listing'))).toBe(
        true,
      )
    } finally {
      cleanup()
    }
  })

  it('emits WARN when binary is not available (not SKIP)', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
default_level: mid
agents:
  codex:
    bin: nonexistent-binary-xyz999
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Normal
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
multiplexer:
  default: herdr
  herdr: { enabled: true, start_command_template: "s", run_command_template: "r" }
`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const modelCheckResults = results.filter(
        (r) => r.message.includes('models check') && r.message.includes('skipped'),
      )
      expect(modelCheckResults.length).toBeGreaterThanOrEqual(1)
      const skipFromBin = modelCheckResults.filter((r) =>
        r.message.includes('binary is not available'),
      )
      expect(skipFromBin.length).toBeGreaterThanOrEqual(1)
      expect(skipFromBin.every((r) => r.status === 'WARN')).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('emits SKIP result when binary is available but adapter does not support model listing', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
default_level: mid
agents:
  codex:
    bin: node
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Normal
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
multiplexer:
  default: herdr
  herdr: { enabled: true, start_command_template: "s", run_command_template: "r" }
`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const hasOnlySkip = results.some((r) => r.status === 'SKIP')
      expect(hasOnlySkip).toBe(true)
    } finally {
      cleanup()
    }
  })
})
