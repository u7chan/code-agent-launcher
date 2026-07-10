import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, configPath, loadConfig } from './config.js'

describe('loadConfig', () => {
  let tmpDir: string
  let originalConfig: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ocgo-config-test-'))
    originalConfig = process.env.OCGO_CONFIG
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (originalConfig === undefined) {
      delete process.env.OCGO_CONFIG
    } else {
      process.env.OCGO_CONFIG = originalConfig
    }
  })

  it('loads a valid config file', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `version: 1
opencode_bin: opencode
provider: opencode-go
default_level: mid
levels:
  mid:
    description: Normal
    default_model: deepseek-v4-pro
    models:
      - deepseek-v4-pro
multiplexer:
  default: herdr
  herdr:
    enabled: true
`,
    )
    process.env.OCGO_CONFIG = configFile

    const config = loadConfig()
    expect(config.version).toBe(2)
    expect(config.default_agent).toBe('opencode-go')
    expect(config.provider).toBe('opencode-go')
    expect(config.default_level).toBe('mid')
    expect(config.levels.mid.default_model).toBe('deepseek-v4-pro')
  })

  it('throws ConfigError for missing file', () => {
    process.env.OCGO_CONFIG = join(tmpDir, 'missing.yaml')
    expect(() => loadConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError for invalid YAML', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(configFile, 'not: valid: yaml: [')
    process.env.OCGO_CONFIG = configFile
    expect(() => loadConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError for missing default_level in levels', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `version: 1
opencode_bin: opencode
provider: opencode-go
default_level: heavy
levels:
  low:
    description: Cheap
    default_model: deepseek-v4-flash
    models:
      - deepseek-v4-flash
multiplexer:
  default: herdr
  herdr:
    enabled: true
`,
    )
    process.env.OCGO_CONFIG = configFile
    expect(() => loadConfig()).toThrow(ConfigError)
  })
})

describe('configPath', () => {
  it('respects XDG_CONFIG_HOME', () => {
    const originalXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test'
    try {
      expect(configPath()).toBe('/tmp/xdg-test/cagent/config.yaml')
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg
      }
    }
  })
})

describe('config v2', () => {
  it('loads an agent-specific v2 config', () => {
    const file = join(tmpdir(), `cagent-v2-${process.pid}.yaml`)
    writeFileSync(
      file,
      `version: 2\ndefault_agent: opencode-go\ndefault_level: low\nagents:\n  opencode-go:\n    bin: custom-opencode\n    provider: opencode-go\n    levels:\n      low:\n        description: Simple\n        default_model: qwen\n        models: [qwen]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(loadConfig(file).agents?.['opencode-go'].bin).toBe('custom-opencode')
    } finally {
      rmSync(file, { force: true })
    }
  })
  it('prefers CAGENT_CONFIG over OCGO_CONFIG', () => {
    const primary = join(tmpdir(), `cagent-primary-${process.pid}.yaml`)
    const legacy = join(tmpdir(), `cagent-legacy-${process.pid}.yaml`)
    const yaml = (bin: string) =>
      `version: 1\nopencode_bin: ${bin}\nprovider: opencode-go\ndefault_level: low\nlevels:\n  low:\n    description: Simple\n    default_model: qwen\n    models: [qwen]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`
    writeFileSync(primary, yaml('primary'))
    writeFileSync(legacy, yaml('legacy'))
    const oldPrimary = process.env.CAGENT_CONFIG
    const oldLegacy = process.env.OCGO_CONFIG
    process.env.CAGENT_CONFIG = primary
    process.env.OCGO_CONFIG = legacy
    try {
      expect(loadConfig().opencode_bin).toBe('primary')
    } finally {
      if (oldPrimary === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = oldPrimary
      if (oldLegacy === undefined) delete process.env.OCGO_CONFIG
      else process.env.OCGO_CONFIG = oldLegacy
      rmSync(primary, { force: true })
      rmSync(legacy, { force: true })
    }
  })
})
