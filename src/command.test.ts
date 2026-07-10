import { describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCommand,
  findExecutable,
  formatCommandForDisplay,
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
    const dir = join(tmpdir(), `ocgo-find-exec-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const binPath = join(dir, 'ocgo-test-bin')
    writeFileSync(binPath, '#!/bin/sh\necho ok\n')
    chmodSync(binPath, 0o755)

    const prevPath = process.env.PATH
    process.env.PATH = `${dir}${prevPath ? `:${prevPath}` : ''}`
    try {
      expect(findExecutable('ocgo-test-bin')).toBe(binPath)
      // Special characters must not be shell-evaluated
      expect(findExecutable('ocgo-test-bin$(touch /tmp/pwned)')).toBeUndefined()
      expect(findExecutable('ocgo-test-bin;id')).toBeUndefined()
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
