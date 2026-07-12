import { describe, expect, it } from 'bun:test'
import { codexAdapter, serializeTomlString } from './codex.js'

const baseContext = {
  bin: 'codex',
  level: 'high',
  cwd: '/tmp',
  extraArgs: ['hello'],
  config: { bin: 'codex', model_id_prefix: false, levels: {} },
}

describe('serializeTomlString', () => {
  it('returns plain value unchanged', () => {
    expect(serializeTomlString('high')).toBe('high')
  })

  it('passes through space, single-quote, dollar, backtick literally', () => {
    expect(serializeTomlString('a b')).toBe('a b')
    expect(serializeTomlString("a'b")).toBe("a'b")
    expect(serializeTomlString('a$b')).toBe('a$b')
    expect(serializeTomlString('a`b')).toBe('a`b')
  })

  it('escapes backslash', () => {
    expect(serializeTomlString('a\\b')).toBe('a\\\\b')
  })

  it('escapes double-quote', () => {
    expect(serializeTomlString('a"b')).toBe('a\\"b')
  })

  it('escapes tab character', () => {
    expect(serializeTomlString('a\tb')).toBe('a\\tb')
  })

  it('escapes newline character', () => {
    expect(serializeTomlString('a\nb')).toBe('a\\nb')
  })

  it('escapes carriage return character', () => {
    expect(serializeTomlString('a\rb')).toBe('a\\rb')
  })

  it('escapes combined special characters', () => {
    expect(serializeTomlString('\\"high\t\n\rlow')).toBe('\\\\\\"high\\t\\n\\rlow')
  })
})

describe('codexAdapter', () => {
  it('passes raw Codex model IDs to codex exec', () => {
    expect(codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol' })).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', 'hello'],
    })
  })

  it('passes -c model_reasoning_effort to codex exec', () => {
    expect(
      codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol', effort: 'high' }),
    ).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high"', 'hello'],
    })
  })

  it('passes -c model_reasoning_effort to codex start', () => {
    expect(
      codexAdapter.buildStartCommand?.({ ...baseContext, modelId: 'gpt-5.6-sol', effort: 'low' }),
    ).toEqual({
      command: 'codex',
      args: ['--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="low"', 'hello'],
    })
  })

  it('does not add -c when effort is not set', () => {
    expect(codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol' })).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', 'hello'],
    })
  })

  it('encodes effort with space in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol', effort: 'high low' }),
    ).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high low"', 'hello'],
    })
  })

  it('encodes effort with single-quote in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol', effort: "high'low" }),
    ).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high\'low"', 'hello'],
    })
  })

  it('encodes effort with double-quote in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'gpt-5.6-sol',
        effort: 'high"low',
      }),
    ).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high\\"low"',
        'hello',
      ],
    })
  })

  it('encodes effort with dollar in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol', effort: 'high$low' }),
    ).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high$low"', 'hello'],
    })
  })

  it('encodes effort with backtick in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol', effort: 'high`low' }),
    ).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high`low"', 'hello'],
    })
  })

  it('encodes effort with backslash in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({ ...baseContext, modelId: 'gpt-5.6-sol', effort: 'high\\low' }),
    ).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high\\\\low"',
        'hello',
      ],
    })
  })

  it('encodes effort with combined special characters in TOML config', () => {
    expect(
      codexAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'gpt-5.6-sol',
        effort: 'high $test"quote\'s`back`\\n',
      }),
    ).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high $test\\"quote\'s`back`\\\\n"',
        'hello',
      ],
    })
  })
})
