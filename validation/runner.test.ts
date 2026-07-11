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
    expect(assertDryRunModel('codex exec --model gpt-5.6-luna hello', 'gpt-5.6-luna')).toBe(true)
    expect(assertDryRunModel('codex exec --model gpt-5.6-sol hello', 'gpt-5.6-luna')).toBe(false)
  })
})
