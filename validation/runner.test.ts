import { describe, expect, it } from 'bun:test'
import { assertDryRunModel, loadMatrix } from './runner.js'

describe('Codex validation matrix', () => {
  it('maps low, mid, and high to the agreed Codex models', () => {
    expect(loadMatrix().codex).toEqual({
      low: { expected_model: 'gpt-5.6-luna' },
      mid: { expected_model: 'gpt-5.6-terra' },
      high: { expected_model: 'gpt-5.6-sol' },
    })
  })

  it('recognizes the Codex model passed by cagent dry-run', () => {
    expect(
      assertDryRunModel('codex exec --model gpt-5.6-luna hello', 'gpt-5.6-luna', 'codex'),
    ).toBe(true)
    expect(assertDryRunModel('codex exec --model gpt-5.6-sol hello', 'gpt-5.6-luna', 'codex')).toBe(
      false,
    )
  })

  it('rejects Codex model when agent is opencode-go', () => {
    expect(
      assertDryRunModel('codex exec --model gpt-5.6-luna hello', 'gpt-5.6-luna', 'opencode-go'),
    ).toBe(false)
  })
})

describe('OpenCode validation matrix', () => {
  it('maps low, mid, and high to the agreed OpenCode models', () => {
    expect(loadMatrix()['opencode-go']).toEqual({
      low: { expected_model: 'opencode-go/deepseek-v4-flash' },
      mid: { expected_model: 'opencode-go/deepseek-v4-pro' },
      high: { expected_model: 'opencode-go/minimax-m3' },
    })
  })

  it('recognizes the OpenCode model passed by cagent dry-run', () => {
    expect(
      assertDryRunModel(
        'opencode run --model opencode-go/deepseek-v4-flash hello',
        'opencode-go/deepseek-v4-flash',
        'opencode-go',
      ),
    ).toBe(true)
    expect(
      assertDryRunModel(
        'opencode run --model opencode-go/deepseek-v4-pro hello',
        'opencode-go/deepseek-v4-flash',
        'opencode-go',
      ),
    ).toBe(false)
  })

  it('rejects OpenCode model when agent is codex', () => {
    expect(
      assertDryRunModel(
        'opencode run --model opencode-go/deepseek-v4-flash hello',
        'opencode-go/deepseek-v4-flash',
        'codex',
      ),
    ).toBe(false)
  })
})

describe('loadMatrix returns both agents', () => {
  it('has codex and opencode-go entries', () => {
    const matrix = loadMatrix()
    expect(Object.keys(matrix)).toContain('codex')
    expect(Object.keys(matrix)).toContain('opencode-go')
  })
})
