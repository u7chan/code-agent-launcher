import { describe, expect, it } from 'bun:test'
import { OpenCodeStartError, opencodeGoAdapter } from './opencode-go.js'

const config = { bin: 'opencode', provider: 'opencode-go', levels: {} }
const baseContext = {
  bin: 'opencode',
  level: 'mid',
  cwd: '/tmp',
  config,
}

describe('opencodeGoAdapter', () => {
  it('builds a non-interactive run command', () => {
    expect(
      opencodeGoAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'opencode-go/model',
        extraArgs: ['prompt'],
      }),
    ).toEqual({ command: 'opencode', args: ['run', '--model', 'opencode-go/model', 'prompt'] })
  })

  it('builds an interactive start command', () => {
    expect(
      opencodeGoAdapter.buildStartCommand?.({
        ...baseContext,
        modelId: 'opencode-go/model',
        extraArgs: [],
      }),
    ).toEqual({ command: 'opencode', args: ['--model', 'opencode-go/model'] })
  })

  it('passes --variant for effort in run command', () => {
    expect(
      opencodeGoAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'opencode-go/model',
        effort: 'high',
        extraArgs: ['prompt'],
      }),
    ).toEqual({
      command: 'opencode',
      args: ['run', '--model', 'opencode-go/model', '--variant', 'high', 'prompt'],
    })
  })

  it('passes special characters in effort via --variant', () => {
    expect(
      opencodeGoAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'opencode-go/model',
        effort: 'high $test',
        extraArgs: [],
      }),
    ).toEqual({
      command: 'opencode',
      args: ['run', '--model', 'opencode-go/model', '--variant', 'high $test'],
    })
  })

  it('throws OpenCodeStartError when start is called with effort', () => {
    expect(() =>
      opencodeGoAdapter.buildStartCommand?.({
        ...baseContext,
        modelId: 'opencode-go/model',
        effort: 'high',
        extraArgs: [],
      }),
    ).toThrow(OpenCodeStartError)
  })

  it('does not add --variant when effort is not set', () => {
    expect(
      opencodeGoAdapter.buildRunCommand({
        ...baseContext,
        modelId: 'opencode-go/model',
        extraArgs: ['prompt'],
      }),
    ).toEqual({ command: 'opencode', args: ['run', '--model', 'opencode-go/model', 'prompt'] })
  })
})
