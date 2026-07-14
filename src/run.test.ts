import { describe, expect, it } from 'bun:test'
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
