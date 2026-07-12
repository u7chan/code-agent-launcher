import { describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCommand,
  findExecutable,
  formatCommandForDisplay,
  formatCommandSpecForShell,
  runCommandFormat,
} from './command.js'

describe('buildCommand', () => {
  it('returns bin name as command when not found in PATH', () => {
    const result = buildCommand('non-existent-bin-xyz', ['--model', 'foo'])
    expect(result.command).toBe('non-existent-bin-xyz')
    expect(result.args).toEqual(['--model', 'foo'])
  })

  it('keeps args unchanged', () => {
    const result = buildCommand('echo', ['hello', 'world'])
    expect(result.args).toEqual(['hello', 'world'])
  })
})

describe('findExecutable', () => {
  it('resolves a binary from PATH without shell evaluation', () => {
    const dir = join(tmpdir(), `cagent-find-exec-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const binPath = join(dir, 'cagent-test-bin')
    writeFileSync(binPath, '#!/bin/sh\necho ok\n')
    chmodSync(binPath, 0o755)

    const prevPath = process.env.PATH
    process.env.PATH = `${dir}${prevPath ? `:${prevPath}` : ''}`
    try {
      expect(findExecutable('cagent-test-bin')).toBe(binPath)
      // Special characters must not be shell-evaluated
      expect(findExecutable('cagent-test-bin$(touch /tmp/pwned)')).toBeUndefined()
      expect(findExecutable('cagent-test-bin;id')).toBeUndefined()
    } finally {
      process.env.PATH = prevPath
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns undefined for missing binaries', () => {
    expect(findExecutable('non-existent-bin-xyz-12345')).toBeUndefined()
  })
})

describe('formatCommandForDisplay', () => {
  it('joins command and args with spaces', () => {
    expect(formatCommandForDisplay('echo', ['hello', 'world'])).toBe('echo hello world')
  })

  it('escapes args containing spaces', () => {
    expect(formatCommandForDisplay('echo', ['hello world'])).toBe('echo "hello world"')
  })

  it('escapes args containing special shell characters', () => {
    expect(formatCommandForDisplay('echo', ['foo|bar'])).toBe('echo "foo|bar"')
    expect(formatCommandForDisplay('echo', ['foo&bar'])).toBe('echo "foo&bar"')
    expect(formatCommandForDisplay('echo', ['foo;bar'])).toBe('echo "foo;bar"')
  })

  it('does not escape simple args', () => {
    expect(formatCommandForDisplay('echo', ['hello'])).toBe('echo hello')
  })
})

describe('runCommandFormat', () => {
  it('produces a full display string with model arg', () => {
    const result = runCommandFormat('opencode', ['--model', 'opencode-go/deepseek-v4-pro'])
    expect(result).toContain('opencode')
    expect(result).toContain('--model')
    expect(result).toContain('opencode-go/deepseek-v4-pro')
  })
})

describe('formatCommandSpecForShell', () => {
  it('wraps simple args in single quotes', () => {
    const result = formatCommandSpecForShell({
      command: 'echo',
      args: ['hello', 'world'],
    })
    expect(result).toBe("'echo' 'hello' 'world'")
  })

  it('protects dollar from shell expansion', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="high$test"'],
    })
    expect(result).toBe("'codex' 'exec' '-c' 'model_reasoning_effort=\"high$test\"'")
  })

  it('protects backtick from shell expansion', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="high`test"'],
    })
    expect(result).toBe("'codex' 'exec' '-c' 'model_reasoning_effort=\"high`test\"'")
  })

  it('protects parentheses from shell subshell', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="$(id)"'],
    })
    expect(result).toBe("'codex' 'exec' '-c' 'model_reasoning_effort=\"$(id)\"'")
  })

  it('escapes single quotes inside args', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="it\'s"'],
    })
    expect(result).toBe("'codex' 'exec' '-c' 'model_reasoning_effort=\"it'\\''s\"'")
  })

  it('handles args with spaces without breaking', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="high low"'],
    })
    expect(result).toBe("'codex' 'exec' '-c' 'model_reasoning_effort=\"high low\"'")
  })

  it('protects semicolons from shell command chaining', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="high;rm -rf /"'],
    })
    expect(result).toBe("'codex' 'exec' '-c' 'model_reasoning_effort=\"high;rm -rf /\"'")
  })

  it('handles full mux command with effort containing special chars', () => {
    const result = formatCommandSpecForShell({
      command: 'codex',
      args: [
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high $test`back`\'quote\'"',
        'hello',
      ],
    })
    expect(result).toBe(
      "'codex' 'exec' '--model' 'gpt-5.6-sol' '-c' 'model_reasoning_effort=\"high $test`back`'\\''quote'\\''\"' 'hello'",
    )
  })
})
