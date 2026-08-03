import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMainCommand } from './main.js'
import { createRunCommand, parseRunArgv } from './run.js'

describe('parseRunArgv', () => {
  it('takes level before -- and prompt after --', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', 'mid', '--', 'hello'])).toEqual({
      positionalLevel: 'mid',
      extraArgs: ['hello'],
    })
  })

  it('does not treat post-- prompt as level when only --model is set', () => {
    expect(
      parseRunArgv(['node', 'cagent', 'run', '--model', 'qwen3.7-plus', '--', 'hello']),
    ).toEqual({
      positionalLevel: undefined,
      extraArgs: ['hello'],
    })
  })

  it('supports level via -l before --', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', '-l', 'high', '--', 'hello'])).toEqual({
      positionalLevel: undefined,
      extraArgs: ['hello'],
    })
  })

  it('keeps extra positionals before -- as extraArgs', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', 'mid', 'extra', '--', 'hello'])).toEqual({
      positionalLevel: 'mid',
      extraArgs: ['extra', 'hello'],
    })
  })

  it('works without -- separator', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', 'mid', 'hello'])).toEqual({
      positionalLevel: 'mid',
      extraArgs: ['hello'],
    })
  })

  it('handles --effort=x correctly', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', '--effort=high', '--', 'prompt'])).toEqual({
      positionalLevel: undefined,
      extraArgs: ['prompt'],
    })
  })

  it('handles --effort x correctly (no = sign)', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', '--effort', 'high', '--', 'prompt'])).toEqual({
      positionalLevel: undefined,
      extraArgs: ['prompt'],
    })
  })

  it('handles -e flag for effort', () => {
    expect(parseRunArgv(['node', 'cagent', 'run', '-e', 'high', '--', 'prompt'])).toEqual({
      positionalLevel: undefined,
      extraArgs: ['prompt'],
    })
  })
})

describe('run JSON output', () => {
  it('outputs a non-interactive dry-run plan as JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cagent-run-json-test-'))
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
      command.addCommand(createRunCommand())
      await command.parseAsync([
        'node',
        'cagent',
        'run',
        'mid',
        '--dry-run',
        '--json',
        '--',
        'hello',
      ])
      expect(logSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
      expect(output.schema_version).toBe(1)
      expect(output.ok).toBe(true)
      expect(output.operation).toBe('run.plan')
      expect(output.data.interactive).toBe(false)
      expect(output.data.command.args).toContain('hello')
    } finally {
      logSpy.mockRestore()
      if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = originalConfig
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects run JSON without dry-run', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    try {
      const command = createMainCommand()
      command.addCommand(createRunCommand())
      await expect(command.parseAsync(['node', 'cagent', 'run', 'mid', '--json'])).rejects.toThrow(
        'process.exit',
      )
      expect(errorSpy.mock.calls[0]?.[0]).toContain(
        'cagent: --json without --dry-run is not supported for code execution.',
      )
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('run config validation', () => {
  it('throws ConfigError before resolving the agent when provider is empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cagent-run-test-'))
    const file = join(dir, 'config.yaml')
    writeFileSync(
      file,
      `default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: ""
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`,
    )
    const originalConfig = process.env.CAGENT_CONFIG
    process.env.CAGENT_CONFIG = file
    const command = createMainCommand()
    command.addCommand(createRunCommand())

    try {
      await expect(command.parseAsync(['node', 'cagent', '--dry-run', 'run'])).rejects.toThrow(
        'agent "opencode-go".provider must not be empty',
      )
    } finally {
      if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = originalConfig
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
