import { describe, expect, it } from 'bun:test'
import { parseRunArgv } from './run.js'

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
