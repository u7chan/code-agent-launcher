import { describe, expect, it } from 'bun:test'
import { codexAdapter, serializeTomlString } from './codex.js'

const baseContext = {
  bin: 'codex',
  level: 'high',
  cwd: '/tmp',
  extraArgs: ['hello'],
  config: { bin: 'codex', provider: 'codex', model_id_prefix: false, levels: {} },
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

  it('escapes backspace character', () => {
    expect(serializeTomlString('a\bb')).toBe('a\\bb')
  })

  it('escapes form feed character', () => {
    expect(serializeTomlString('a\fb')).toBe('a\\fb')
  })

  it('escapes control character U+0000 (null)', () => {
    expect(serializeTomlString('a\x00b')).toBe('a\\u0000b')
  })

  it('escapes control character U+0001 (SOH)', () => {
    expect(serializeTomlString('a\x01b')).toBe('a\\u0001b')
  })

  it('escapes control character U+001F (unit separator)', () => {
    expect(serializeTomlString('a\x1Fb')).toBe('a\\u001fb')
  })

  it('escapes DEL character U+007F', () => {
    expect(serializeTomlString('a\x7Fb')).toBe('a\\u007fb')
  })

  it('escapes mixed control and named escapes', () => {
    expect(serializeTomlString('\x00high\b\n\x1Flow\r\f\x7F')).toBe(
      '\\u0000high\\b\\n\\u001flow\\r\\f\\u007f',
    )
  })

  it('does not provide buildModelListCommand', () => {
    expect(codexAdapter.buildModelListCommand).toBeUndefined()
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

  it('encodes effort with backspace and form feed as TOML escapes', () => {
    expect(
      codexAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'gpt-5.6-sol',
        effort: 'high\b\flow',
      }),
    ).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high\\b\\flow"',
        'hello',
      ],
    })
  })

  it('encodes effort with U+0000 as TOML unicode escape', () => {
    expect(
      codexAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'gpt-5.6-sol',
        effort: 'high\x00low',
      }),
    ).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high\\u0000low"',
        'hello',
      ],
    })
  })
})
