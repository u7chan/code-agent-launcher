import { describe, expect, it } from 'bun:test'
import { opencodeGoAdapter } from './opencode-go.js'
const config = { bin: 'opencode', provider: 'opencode-go', levels: {} }
describe('opencodeGoAdapter', () => {
  it('builds a non-interactive run command', () => {
    expect(
      opencodeGoAdapter.buildRunCommand({
        bin: 'opencode',
        modelId: 'opencode-go/model',
        level: 'mid',
        cwd: '/tmp',
        extraArgs: ['prompt'],
        config,
      }),
    ).toEqual({ command: 'opencode', args: ['run', '--model', 'opencode-go/model', 'prompt'] })
  })
  it('builds an interactive start command', () => {
    expect(
      opencodeGoAdapter.buildStartCommand?.({
        bin: 'opencode',
        modelId: 'opencode-go/model',
        level: 'mid',
        cwd: '/tmp',
        extraArgs: [],
        config,
      }),
    ).toEqual({ command: 'opencode', args: ['--model', 'opencode-go/model'] })
  })
})
