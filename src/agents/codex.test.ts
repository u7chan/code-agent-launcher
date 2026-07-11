import { describe, expect, it } from 'bun:test'
import { codexAdapter } from './codex.js'

describe('codexAdapter', () => {
  it('passes raw Codex model IDs to codex exec', () => {
    expect(
      codexAdapter.buildRunCommand({
        bin: 'codex',
        modelId: 'gpt-5.6-sol',
        level: 'high',
        cwd: '/tmp',
        extraArgs: ['hello'],
        config: { bin: 'codex', model_id_prefix: false, levels: {} },
      }),
    ).toEqual({ command: 'codex', args: ['exec', '--model', 'gpt-5.6-sol', 'hello'] })
  })
})
