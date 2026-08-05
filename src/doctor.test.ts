import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CheckResult, printResults, runDoctor } from './doctor.js'

function writeTempConfig(content: string): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cagent-doctor-test-'))
  const file = join(dir, 'config.yaml')
  writeFileSync(file, content)
  return {
    file,
    cleanup: () => {
      delete process.env.CAGENT_CONFIG
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const MULTIPLEXER_TAIL = `multiplexer:
  default: herdr
  herdr: { enabled: true }
`

describe('doctor JSON output', () => {
  it('outputs a versioned summary and checks without human formatting', () => {
    const results: CheckResult[] = [
      { status: 'OK', message: 'config file exists', id: 'config.exists' },
      { status: 'WARN', message: 'binary unavailable', id: 'agent.bin', details: { path: null } },
      { status: 'ERROR', message: 'invalid config', id: 'config.valid' },
      { status: 'SKIP', message: 'not applicable', id: 'agent.models.list' },
    ]
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      printResults(results, true)
      expect(logSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
      expect(output.schema_version).toBe(1)
      expect(output.ok).toBe(true)
      expect(output.operation).toBe('doctor')
      expect(output.data.summary).toEqual({ ok: 1, warn: 1, error: 1, skip: 1 })
      expect(output.data.checks[0].id).toBe('config.exists')
      expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('[OK]')
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('doctor effort reporting', () => {
  it('reports opencode-go effort as effective with run --variant', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: opencode-go
profiles:
  mid:
    agent: opencode-go
    model: ${'test-model'}
    effort: high
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const effortResults = results.filter((r) => r.message.includes('effort'))
      expect(effortResults.length).toBeGreaterThanOrEqual(1)
      const openCodeEffort = effortResults.find((r) => r.message.includes('opencode-go'))
      expect(openCodeEffort).not.toBeUndefined()
      expect(openCodeEffort?.status).toBe('OK')
      expect(openCodeEffort?.message).toContain('--variant')
      expect(openCodeEffort?.message).toContain('Interactive')
    } finally {
      cleanup()
    }
  })

  it('reports codex effort as passed via -c model_reasoning_effort', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
profiles:
  mid:
    agent: codex
    model: ${'test-model'}
    effort: high
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const effortResults = results.filter((r) => r.message.includes('effort'))
      expect(effortResults.length).toBeGreaterThanOrEqual(1)
      const codexEffort = effortResults.find((r) => r.message.includes('codex'))
      expect(codexEffort).not.toBeUndefined()
      expect(codexEffort?.status).toBe('OK')
      expect(codexEffort?.message).toContain('-c model_reasoning_effort')
    } finally {
      cleanup()
    }
  })

  it('reports multi-agent config with different efforts correctly', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: opencode-go
profiles:
  opencode-mid:
    agent: opencode-go
    model: ${'test-model-a'}
    effort: mid-effort
  opencode-high:
    agent: opencode-go
    model: ${'test-model-b'}
    effort: high-effort
  codex-low:
    agent: codex
    model: ${'test-model-c'}
    effort: low-effort
  codex-mid:
    agent: codex
    model: ${'test-model-d'}
    effort: mid-effort
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const effortResults = results.filter((r) => r.message.includes('effort'))
      expect(effortResults.length).toBe(4)

      const opencodeMid = effortResults.find(
        (r) =>
          r.message.includes('opencode-go') &&
          r.message.includes('opencode-mid') &&
          !r.message.includes('opencode-high'),
      )
      expect(opencodeMid).not.toBeUndefined()
      expect(opencodeMid?.status).toBe('OK')
      expect(opencodeMid?.message).toContain('--variant')

      const opencodeHigh = effortResults.find(
        (r) => r.message.includes('opencode-go') && r.message.includes('opencode-high'),
      )
      expect(opencodeHigh).not.toBeUndefined()
      expect(opencodeHigh?.status).toBe('OK')

      const codexLow = effortResults.find(
        (r) => r.message.includes('codex') && r.message.includes('codex-low'),
      )
      expect(codexLow).not.toBeUndefined()
      expect(codexLow?.status).toBe('OK')
      expect(codexLow?.message).toContain('-c model_reasoning_effort')

      const codexMid = effortResults.find(
        (r) =>
          r.message.includes('codex') &&
          r.message.includes('codex-mid') &&
          !r.message.includes('codex-low'),
      )
      expect(codexMid).not.toBeUndefined()
      expect(codexMid?.status).toBe('OK')
    } finally {
      cleanup()
    }
  })

  it('does not report effort when not configured', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: opencode-go
profiles:
  mid:
    agent: opencode-go
    model: ${'test-model'}
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const effortResults = results.filter((r) => r.message.includes('effort'))
      expect(effortResults.length).toBe(0)
    } finally {
      cleanup()
    }
  })
})

describe('doctor agent resolution', () => {
  it('inspects the specified agent when agentId is passed', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
profiles:
  balanced:
    agent: opencode-go
    model: ${'test-model-a'}
  frontier:
    agent: codex
    model: ${'test-model-b'}
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor({}, 'opencode-go')

      const binMessages = results.filter((r) => r.message.includes('binary'))
      expect(binMessages.some((r) => r.message.includes('opencode-go'))).toBe(true)
      expect(binMessages.some((r) => r.message.includes('codex'))).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('stops at config validation when an agent provider is missing', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: opencode-go
profiles:
  mid:
    agent: opencode-go
    model: ${'test-model'}
agents:
  opencode-go:
    bin: opencode
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()

      expect(results).toHaveLength(2)
      expect(results[1]).toEqual({
        status: 'ERROR',
        message: 'config validation failed: agent "opencode-go".provider must be a string',
        id: 'config.valid',
        details: { path: file },
      })
    } finally {
      cleanup()
    }
  })

  it('falls back to default_agent when agentId is not passed', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
profiles:
  balanced:
    agent: opencode-go
    model: ${'test-model-a'}
  frontier:
    agent: codex
    model: ${'test-model-b'}
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()

      const binMessages = results.filter((r) => r.message.includes('binary'))
      expect(binMessages.some((r) => r.message.includes('codex'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('errors when specified agentId is not in config', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
profiles:
  balanced:
    agent: codex
    model: ${'test-model'}
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
${MULTIPLEXER_TAIL}`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor({}, 'nonexistent')
      const errorResults = results.filter((r) => r.status === 'ERROR')
      expect(errorResults.some((r) => r.message.includes('nonexistent'))).toBe(true)
    } finally {
      cleanup()
    }
  })
})
