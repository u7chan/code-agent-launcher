import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigError,
  configPath,
  getAgent,
  loadConfig,
  resolveConfigPath,
  resolveConfigPathWithSource,
} from './config.js'

describe('loadConfig', () => {
  let tmpDir: string
  let originalConfig: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cagent-config-test-'))
    originalConfig = process.env.CAGENT_CONFIG
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (originalConfig === undefined) {
      delete process.env.CAGENT_CONFIG
    } else {
      process.env.CAGENT_CONFIG = originalConfig
    }
  })

  it('loads a valid config file', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
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
    process.env.CAGENT_CONFIG = configFile

    const config = loadConfig()
    expect(config.default_agent).toBe('opencode-go')
    expect(config.default_level).toBe('mid')
    expect(config.agents['opencode-go'].levels.mid.default_model).toBe('deepseek-v4-pro')
  })

  it('throws ConfigError for missing file', () => {
    process.env.CAGENT_CONFIG = join(tmpDir, 'missing.yaml')
    expect(() => loadConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError for invalid YAML', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(configFile, 'not: valid: yaml: [')
    process.env.CAGENT_CONFIG = configFile
    expect(() => loadConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError for missing default_agent in agents', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: none
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
`,
    )
    process.env.CAGENT_CONFIG = configFile
    expect(() => loadConfig()).toThrow('default_agent')
  })

  it('throws ConfigError for default_agent that is an inherited Object.prototype name', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: toString
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
`,
    )
    process.env.CAGENT_CONFIG = configFile
    expect(() => loadConfig()).toThrow('default_agent "toString" is not defined in agents')
  })

  it('throws ConfigError for missing default_level in agent levels', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: opencode-go
default_level: heavy
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
    levels:
      low:
        description: Cheap
        default_model: deepseek-v4-flash
        models: [deepseek-v4-flash]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`,
    )
    process.env.CAGENT_CONFIG = configFile
    expect(() => loadConfig()).toThrow('default_level')
  })

  it('throws ConfigError when an agent provider is missing', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: opencode-go
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
`,
    )
    process.env.CAGENT_CONFIG = configFile

    expect(() => loadConfig()).toThrow('agent "opencode-go".provider must be a string')
  })

  it('throws ConfigError when an agent provider is empty', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: ""
    levels:
      mid:
        description: Normal
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
multiplexer:
  default: herdr
  herdr: { enabled: true }
`,
    )
    process.env.CAGENT_CONFIG = configFile

    expect(() => loadConfig()).toThrow('agent "opencode-go".provider must not be empty')
  })

  it('rejects legacy opencode_bin config', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `opencode_bin: opencode
default_agent: opencode-go
default_level: mid
agents: {}
multiplexer:
  default: herdr
`,
    )
    process.env.CAGENT_CONFIG = configFile

    expect(() => loadConfig()).toThrow(
      'legacy config format is unsupported; define agents and default_agent instead',
    )
  })

  it('rejects legacy top-level levels config', () => {
    const configFile = join(tmpDir, 'config.yaml')
    writeFileSync(
      configFile,
      `default_agent: opencode-go
default_level: mid
levels:
  mid:
    description: Normal
    default_model: deepseek-v4-pro
    models: [deepseek-v4-pro]
multiplexer:
  default: herdr
`,
    )
    process.env.CAGENT_CONFIG = configFile

    expect(() => loadConfig()).toThrow(
      'legacy config format is unsupported; define agents and default_agent instead',
    )
  })
})

describe('getAgent', () => {
  function makeConfig() {
    return {
      default_agent: 'opencode-go',
      default_level: 'mid',
      agents: {
        'opencode-go': {
          bin: 'opencode',
          provider: 'opencode-go',
          levels: { mid: { description: 'Normal', default_model: 'm', models: ['m'] } },
        },
        codex: {
          bin: 'codex',
          provider: 'codex',
          model_id_prefix: false,
          levels: { low: { description: 'Fast', default_model: 'g', models: ['g'] } },
        },
      },
      multiplexer: { default: 'herdr', herdr: { enabled: true } },
    }
  }

  it('returns agent by id', () => {
    expect(getAgent(makeConfig(), 'opencode-go').bin).toBe('opencode')
    expect(getAgent(makeConfig(), 'codex').bin).toBe('codex')
  })

  it('throws for unknown agent', () => {
    const config = makeConfig()
    expect(() => getAgent(config, 'unknown')).toThrow('unknown agent')
    expect(() => getAgent(config, 'unknown')).toThrow('Available agents')
  })

  it('throws for an inherited Object.prototype name as agent', () => {
    const config = makeConfig()
    expect(() => getAgent(config, 'toString')).toThrow('unknown agent')
    expect(() => getAgent(config, 'toString')).toThrow('Available agents')
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

describe('resolveConfigPath', () => {
  let tmpDir: string
  let originalConfig: string | undefined
  let originalXdg: string | undefined
  let originalHome: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cagent-resolve-path-test-'))
    originalConfig = process.env.CAGENT_CONFIG
    originalXdg = process.env.XDG_CONFIG_HOME
    originalHome = process.env.HOME
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
    else process.env.CAGENT_CONFIG = originalConfig
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdg
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  it('prioritizes CAGENT_CONFIG and reports its source', () => {
    const customPath = join(tmpDir, 'custom.yaml')
    process.env.CAGENT_CONFIG = customPath
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg')

    expect(resolveConfigPath()).toBe(customPath)
    expect(resolveConfigPathWithSource()).toEqual({
      path: customPath,
      source: 'CAGENT_CONFIG',
    })
  })

  it('uses XDG_CONFIG_HOME and reports its source', () => {
    const xdgHome = join(tmpDir, 'xdg')
    delete process.env.CAGENT_CONFIG
    process.env.XDG_CONFIG_HOME = xdgHome

    expect(resolveConfigPath()).toBe(join(xdgHome, 'cagent', 'config.yaml'))
    expect(resolveConfigPathWithSource()).toEqual({
      path: join(xdgHome, 'cagent', 'config.yaml'),
      source: 'XDG_CONFIG_HOME',
    })
  })

  it('falls back to HOME and reports its source', () => {
    const home = join(tmpDir, 'home')
    delete process.env.CAGENT_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.HOME = home

    expect(resolveConfigPath()).toBe(join(home, '.config', 'cagent', 'config.yaml'))
    expect(resolveConfigPathWithSource()).toEqual({
      path: join(home, '.config', 'cagent', 'config.yaml'),
      source: 'HOME',
    })
  })
})

describe('level effort validation', () => {
  it('accepts a valid effort string', () => {
    const file = join(tmpdir(), `cagent-effort-valid-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\n        effort: high\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      const config = loadConfig(file)
      expect(config.agents['opencode-go'].levels.mid.effort).toBe('high')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('accepts undefined effort (no key)', () => {
    const file = join(tmpdir(), `cagent-effort-none-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      const config = loadConfig(file)
      expect(config.agents['opencode-go'].levels.mid.effort).toBeUndefined()
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects empty string effort', () => {
    const file = join(tmpdir(), `cagent-effort-empty-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\n        effort: ""\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects numeric effort', () => {
    const file = join(tmpdir(), `cagent-effort-num-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\n        effort: 42\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects boolean effort', () => {
    const file = join(tmpdir(), `cagent-effort-bool-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\n        effort: true\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects null effort', () => {
    const file = join(tmpdir(), `cagent-effort-null-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\n        effort: null\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
    } finally {
      rmSync(file, { force: true })
    }
  })
})

describe('profile validation', () => {
  const base = `default_agent: opencode-go\ndefault_level: mid\nagents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Normal\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\n  codex:\n    bin: codex\n    provider: codex\n    model_id_prefix: false\n    levels:\n      mid:\n        description: Balanced\n        default_model: gpt-5.6-terra\n        models: [gpt-5.6-terra]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`

  function profileFile(profiles: string, defaultProfile?: string): string {
    const file = join(tmpdir(), `cagent-profile-test-${Math.random()}-${process.pid}.yaml`)
    const def = defaultProfile !== undefined ? `default_profile: ${defaultProfile}\n` : ''
    writeFileSync(file, `${def}${base}${profiles}`, 'utf-8')
    return file
  }

  it('loads named profiles with a defined default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n  frontier:\n    agent: codex\n    model: gpt-5.6-sol\n    effort: xhigh\n',
      'fast',
    )
    try {
      const config = loadConfig(file)
      expect(config.default_profile).toBe('fast')
      expect(config.profiles?.fast).toEqual({
        agent: 'opencode-go',
        model: 'deepseek-v4-flash',
      })
      expect(config.profiles?.frontier).toEqual({
        agent: 'codex',
        model: 'gpt-5.6-sol',
        effort: 'xhigh',
      })
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('loads a config without profiles', () => {
    const file = profileFile('')
    try {
      const config = loadConfig(file)
      expect(config.profiles).toBeUndefined()
      expect(config.default_profile).toBeUndefined()
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a default_profile that is not defined in profiles', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      'missing',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('default_profile "missing" is not defined in profiles')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a default_profile without a profiles section', () => {
    const file = profileFile('', 'fast')
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('default_profile "fast" is not defined in profiles')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects an empty default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      '""',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('default_profile must not be empty')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('accepts profiles without a default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
    )
    try {
      const config = loadConfig(file)
      expect(config.profiles).toBeDefined()
      expect(config.profiles?.fast).toBeDefined()
      expect(config.default_profile).toBeUndefined()
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a profile whose agent is not defined in agents', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: unknown-agent\n    model: deepseek-v4-flash\n',
      'fast',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow(
        'profile "fast".agent "unknown-agent" is not defined in agents',
      )
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a profile whose agent is an inherited Object.prototype name', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: toString\n    model: deepseek-v4-flash\n',
      'fast',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow(
        'profile "fast".agent "toString" is not defined in agents',
      )
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a default_profile that is an inherited Object.prototype name', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      'toString',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow(
        'default_profile "toString" is not defined in profiles',
      )
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a profile with an empty model', () => {
    const file = profileFile('profiles:\n  fast:\n    agent: opencode-go\n    model: ""\n', 'fast')
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profile "fast".model must not be empty')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a profile with a missing model', () => {
    const file = profileFile('profiles:\n  fast:\n    agent: opencode-go\n', 'fast')
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profile "fast".model must be a string')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects an empty profile name', () => {
    const file = profileFile(
      'profiles:\n  "":\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      '""',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profile name must not be empty')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a profile entry that is not an object', () => {
    const file = profileFile('profiles:\n  fast: not-an-object\n', 'fast')
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profile "fast" must be an object')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects profiles that are not an object', () => {
    const file = profileFile('profiles: [fast]')
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profiles must be an object')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects an empty profile effort', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n    effort: ""\n',
      'fast',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profile "fast".effort must not be empty')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('rejects a numeric profile effort', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n    effort: 42\n',
      'fast',
    )
    try {
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow('profile "fast".effort must be a string')
    } finally {
      rmSync(file, { force: true })
    }
  })
})

describe('config', () => {
  it('loads an agent-specific config', () => {
    const file = join(tmpdir(), `cagent-agent-specific-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: low\nagents:\n  opencode-go:\n    bin: custom-opencode\n    provider: opencode-go\n    levels:\n      low:\n        description: Simple\n        default_model: qwen\n        models: [qwen]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(loadConfig(file).agents['opencode-go'].bin).toBe('custom-opencode')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('preserves model_id_prefix=false for Codex model IDs', () => {
    const file = join(tmpdir(), `cagent-codex-prefix-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: codex\ndefault_level: low\nagents:\n  codex:\n    bin: codex\n    provider: codex\n    model_id_prefix: false\n    levels:\n      low:\n        description: Simple\n        default_model: gpt-5.6-luna\n        models: [gpt-5.6-luna]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      expect(loadConfig(file).agents.codex.model_id_prefix).toBe(false)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('accepts codex as default_agent', () => {
    const file = join(tmpdir(), `cagent-codex-default-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: codex\ndefault_level: mid\nagents:\n  codex:\n    bin: codex\n    provider: codex\n    model_id_prefix: false\n    levels:\n      mid:\n        description: Balanced\n        default_model: gpt-5.6-terra\n        models: [gpt-5.6-terra]\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Balanced\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      const config = loadConfig(file)
      expect(config.default_agent).toBe('codex')
      expect(config.agents.codex.bin).toBe('codex')
      expect(config.agents['opencode-go'].bin).toBe('opencode')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('allows switching default_agent to opencode-go', () => {
    const file = join(tmpdir(), `cagent-switch-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: opencode-go\ndefault_level: mid\nagents:\n  codex:\n    bin: codex\n    provider: codex\n    model_id_prefix: false\n    levels:\n      mid:\n        description: Balanced\n        default_model: gpt-5.6-terra\n        models: [gpt-5.6-terra]\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels:\n      mid:\n        description: Balanced\n        default_model: deepseek-v4-pro\n        models: [deepseek-v4-pro]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    try {
      const config = loadConfig(file)
      expect(config.default_agent).toBe('opencode-go')
      expect(config.agents['opencode-go'].bin).toBe('opencode')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('uses CAGENT_CONFIG env var', () => {
    const primary = join(tmpdir(), `cagent-primary-${process.pid}.yaml`)
    writeFileSync(
      primary,
      `default_agent: opencode-go\ndefault_level: low\nagents:\n  opencode-go:\n    bin: primary-opencode\n    provider: opencode-go\n    levels:\n      low:\n        description: Simple\n        default_model: qwen\n        models: [qwen]\nmultiplexer:\n  default: herdr\n  herdr: { enabled: true }\n`,
    )
    const oldPrimary = process.env.CAGENT_CONFIG
    process.env.CAGENT_CONFIG = primary
    try {
      expect(loadConfig().agents['opencode-go'].bin).toBe('primary-opencode')
    } finally {
      if (oldPrimary === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = oldPrimary
      rmSync(primary, { force: true })
    }
  })
})
