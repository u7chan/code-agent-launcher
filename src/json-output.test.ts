import { describe, expect, it, spyOn } from 'bun:test'
import {
  isJsonMode,
  JSON_SCHEMA_VERSION,
  outputJsonFailure,
  outputJsonSuccess,
} from './json-output.js'

describe('json output', () => {
  it('outputs a versioned success envelope', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      outputJsonSuccess('test', { value: 'ok' })
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
      expect(output).toEqual({
        schema_version: JSON_SCHEMA_VERSION,
        ok: true,
        operation: 'test',
        data: { value: 'ok' },
        warnings: [],
      })
    } finally {
      logSpy.mockRestore()
    }
  })

  it('outputs a versioned failure envelope', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      outputJsonFailure('test', 'TEST_ERROR', 'failed', { value: 1 }, 'retry')
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
      expect(output).toEqual({
        schema_version: JSON_SCHEMA_VERSION,
        ok: false,
        operation: 'test',
        error: {
          code: 'TEST_ERROR',
          message: 'failed',
          details: { value: 1 },
          suggestion: 'retry',
        },
      })
    } finally {
      logSpy.mockRestore()
    }
  })

  it('detects JSON mode only for an explicit true value', () => {
    expect(isJsonMode({ json: true })).toBe(true)
    expect(isJsonMode({ json: false })).toBe(false)
    expect(isJsonMode({})).toBe(false)
  })
})
