import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from './doctor.js'

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

describe('doctor effort reporting', () => {
  it('reports opencode-go effort as effective with run --variant', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
        effort: high
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
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
default_level: mid
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Normal
        default_model: gpt-5
        models: [gpt-5]
        effort: high
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
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
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
        effort: mid-effort
      high:
        description: Complex
        default_model: kimi-k2.7-code
        models: [kimi-k2.7-code]
        effort: high-effort
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      low:
        description: Simple
        default_model: gpt-5.6-luna
        models: [gpt-5.6-luna]
        effort: low-effort
      mid:
        description: Normal
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
        effort: mid-effort
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()
      const effortResults = results.filter((r) => r.message.includes('effort'))
      expect(effortResults.length).toBe(4)

      const opencodeMid = effortResults.find(
        (r) =>
          r.message.includes('opencode-go') &&
          r.message.includes('mid') &&
          !r.message.includes('high'),
      )
      expect(opencodeMid).not.toBeUndefined()
      expect(opencodeMid?.status).toBe('OK')
      expect(opencodeMid?.message).toContain('--variant')

      const opencodeHigh = effortResults.find(
        (r) => r.message.includes('opencode-go') && r.message.includes('high'),
      )
      expect(opencodeHigh).not.toBeUndefined()
      expect(opencodeHigh?.status).toBe('OK')

      const codexLow = effortResults.find(
        (r) => r.message.includes('codex') && r.message.includes('low'),
      )
      expect(codexLow).not.toBeUndefined()
      expect(codexLow?.status).toBe('OK')
      expect(codexLow?.message).toContain('-c model_reasoning_effort')

      const codexMid = effortResults.find(
        (r) =>
          r.message.includes('codex') && r.message.includes('mid') && !r.message.includes('high'),
      )
      expect(codexMid).not.toBeUndefined()
      expect(codexMid?.status).toBe('OK')
    } finally {
      cleanup()
    }
  })

  it('does not report effort when not configured', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
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
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Balanced
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
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
default_level: mid
agents:
  opencode-go:
    bin: opencode
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
    process.env.CAGENT_CONFIG = file
    try {
      const results = runDoctor()

      expect(results).toHaveLength(2)
      expect(results[1]).toEqual({
        status: 'ERROR',
        message: 'config validation failed: agent "opencode-go".provider must be a string',
      })
    } finally {
      cleanup()
    }
  })

  it('falls back to default_agent when agentId is not passed', () => {
    const { file, cleanup } = writeTempConfig(`default_agent: codex
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Balanced
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
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
default_level: mid
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Balanced
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`)
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
