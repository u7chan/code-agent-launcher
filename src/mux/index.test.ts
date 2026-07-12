import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { MuxAdapterError, resolveMuxCommand, validateMuxAdapter } from './index.js'

function writeTempConfig(content: string): { dir: string; file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cagent-mux-test-'))
  const file = join(dir, 'config.yaml')
  writeFileSync(file, content)
  return {
    dir,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function clearEffortEnv() {
  delete process.env.CAGENT_MODEL
  delete process.env.CAGENT_LEVEL
  delete process.env.CAGENT_EFFORT
}

const codexConfig = `version: 2
default_agent: codex
default_level: mid
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Medium
        default_model: gpt-5
        models: [gpt-5]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`

const opencodeConfig = `version: 2
default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      mid:
        description: Medium
        default_model: gpt-5
        models: [gpt-5]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`

describe('validateMuxAdapter', () => {
  it('succeeds for enabled adapter', () => {
    const { file, cleanup } = writeTempConfig(codexConfig)
    try {
      const config = loadConfig(file)
      const adapter = validateMuxAdapter(config, 'herdr')
      expect(adapter.enabled).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('throws MuxAdapterError for disabled adapter', () => {
    const { file, cleanup } = writeTempConfig(
      `version: 2\ndefault_agent: opencode-go\ndefault_level: low\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      low:\n        description: Simple\n        default_model: qwen\n        models: [qwen]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: false }\n`,
    )
    try {
      const config = loadConfig(file)
      expect(() => validateMuxAdapter(config, 'herdr')).toThrow(MuxAdapterError)
    } finally {
      cleanup()
    }
  })

  it('throws MuxAdapterError for unknown adapter', () => {
    const { file, cleanup } = writeTempConfig(
      `version: 2\ndefault_agent: opencode-go\ndefault_level: low\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      low:\n        description: Simple\n        default_model: qwen\n        models: [qwen]\nmultiplexer:\n  default: unknown\n  unknown: { enabled: true }\n`,
    )
    try {
      const config = loadConfig(file)
      expect(() => validateMuxAdapter(config, 'nonexistent')).toThrow(MuxAdapterError)
    } finally {
      cleanup()
    }
  })
})

describe('resolveMuxCommand', () => {
  it('mux run passes effort as -c model_reasoning_effort for Codex', () => {
    clearEffortEnv()
    const { file, cleanup } = writeTempConfig(codexConfig)
    try {
      const config = loadConfig(file)
      const { commandSpec } = resolveMuxCommand(config, 'run', 'mid', { effort: 'high' }, ['hello'])
      expect(commandSpec.command).toBe('codex')
      expect(commandSpec.args).toContain('-c')
      expect(commandSpec.args).toContain('model_reasoning_effort="high"')
    } finally {
      cleanup()
    }
  })

  it('mux run passes effort as --variant for OpenCode', () => {
    clearEffortEnv()
    const { file, cleanup } = writeTempConfig(opencodeConfig)
    try {
      const config = loadConfig(file)
      const { commandSpec } = resolveMuxCommand(config, 'run', 'mid', { effort: 'high' }, ['hello'])
      expect(commandSpec.command).toBe('opencode')
      expect(commandSpec.args).toContain('--variant')
      expect(commandSpec.args).toContain('high')
    } finally {
      cleanup()
    }
  })

  it('mux start + opencode-go + effort throws MuxAdapterError (fail-fast before herdr pane operations)', () => {
    clearEffortEnv()
    const { file, cleanup } = writeTempConfig(opencodeConfig)
    try {
      const config = loadConfig(file)
      expect(() => resolveMuxCommand(config, 'start', 'mid', { effort: 'high' }, [])).toThrow(
        MuxAdapterError,
      )
    } finally {
      cleanup()
    }
  })
})
