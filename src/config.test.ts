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

const validConfig = `default_agent: opencode-go
default_profile: balanced
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
profiles:
  fast:
    agent: opencode-go
    model: deepseek-v4-flash
  balanced:
    agent: opencode-go
    model: deepseek-v4-pro
  frontier:
    agent: codex
    model: gpt-5.6-sol
    effort: xhigh
multiplexer:
  default: herdr
  herdr:
    enabled: true
`

describe('loadConfig', () => {
  let tmpDir: string
  let originalConfig: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cagent-config-test-'))
    originalConfig = process.env.CAGENT_CONFIG
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
    else process.env.CAGENT_CONFIG = originalConfig
  })

  function loadText(content: string): ReturnType<typeof loadConfig> {
    const file = join(tmpDir, `config-${Math.random()}.yaml`)
    writeFileSync(file, content, 'utf-8')
    return loadConfig(file)
  }

  it('loads agents and profiles without level fields', () => {
    const config = loadText(validConfig)

    expect(config.default_agent).toBe('opencode-go')
    expect(config.default_profile).toBe('balanced')
    expect(config.agents['opencode-go']).toEqual({
      bin: 'opencode',
      provider: 'opencode-go',
      model_id_prefix: true,
    })
    expect(config.agents.codex).toEqual({
      bin: 'codex',
      provider: 'codex',
      model_id_prefix: false,
    })
    expect(config.profiles?.frontier).toEqual({
      agent: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    })
    expect(Object.hasOwn(config, 'default_level')).toBe(false)
    expect(Object.hasOwn(config.agents.codex, 'levels')).toBe(false)
  })

  it('loads a config without profiles or a default_profile', () => {
    const config = loadText(`default_agent: opencode-go
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
multiplexer:
  default: herdr
`)

    expect(config.profiles).toBeUndefined()
    expect(config.default_profile).toBeUndefined()
  })

  it('throws ConfigError for missing file', () => {
    process.env.CAGENT_CONFIG = join(tmpDir, 'missing.yaml')
    expect(() => loadConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError for invalid YAML', () => {
    expect(() => loadText('not: valid: yaml: [')).toThrow(ConfigError)
  })

  it('throws ConfigError for missing default_agent in agents', () => {
    expect(() =>
      loadText(`default_agent: none
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
multiplexer:
  default: herdr
`),
    ).toThrow('default_agent "none" is not defined in agents')
  })

  it('throws ConfigError for an inherited Object.prototype agent name', () => {
    expect(() =>
      loadText(`default_agent: toString
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
multiplexer:
  default: herdr
`),
    ).toThrow('default_agent "toString" is not defined in agents')
  })

  it('throws ConfigError when an agent provider is missing', () => {
    expect(() =>
      loadText(`default_agent: opencode-go
agents:
  opencode-go:
    bin: opencode
multiplexer:
  default: herdr
`),
    ).toThrow('agent "opencode-go".provider must be a string')
  })

  it('throws ConfigError when an agent provider is empty', () => {
    expect(() =>
      loadText(`default_agent: opencode-go
agents:
  opencode-go:
    bin: opencode
    provider: ""
multiplexer:
  default: herdr
`),
    ).toThrow('agent "opencode-go".provider must not be empty')
  })

  it('rejects the legacy opencode_bin config', () => {
    expect(() =>
      loadText(`opencode_bin: opencode
default_agent: opencode-go
agents: {}
multiplexer:
  default: herdr
`),
    ).toThrow('legacy config format is unsupported')
  })

  it.each([
    ['a root level section', 'levels:\n  mid: {}\n'],
    ['a root default_level', 'default_level: mid\n'],
    ['a root models array', 'models: [gpt-5]\n'],
    [
      'an agent levels section',
      'agents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    levels: {}\n',
    ],
    [
      'an agent models array',
      'agents:\n  opencode-go:\n    bin: opencode\n    provider: opencode-go\n    models: [gpt-5]\n',
    ],
  ])('rejects %s from the legacy contract', (_name, fragment) => {
    expect(() =>
      loadText(`default_agent: opencode-go
${fragment}multiplexer:
  default: herdr
`),
    ).toThrow('legacy config format is unsupported')
  })
})

describe('getAgent', () => {
  const config = {
    default_agent: 'opencode-go',
    agents: {
      'opencode-go': { bin: 'opencode', provider: 'opencode-go' },
      codex: { bin: 'codex', provider: 'codex', model_id_prefix: false },
    },
    multiplexer: { default: 'herdr', herdr: { enabled: true } },
  }

  it('returns an agent by id', () => {
    expect(getAgent(config, 'opencode-go').bin).toBe('opencode')
    expect(getAgent(config, 'codex').bin).toBe('codex')
  })

  it('throws for an unknown agent', () => {
    expect(() => getAgent(config, 'unknown')).toThrow('unknown agent')
    expect(() => getAgent(config, 'unknown')).toThrow('Available agents')
  })

  it('throws for an inherited Object.prototype name', () => {
    expect(() => getAgent(config, 'toString')).toThrow('unknown agent')
  })
})

describe('config paths', () => {
  it('respects XDG_CONFIG_HOME', () => {
    const originalXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test'
    try {
      expect(configPath()).toBe('/tmp/xdg-test/cagent/config.yaml')
    } finally {
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = originalXdg
    }
  })

  it('prioritizes CAGENT_CONFIG and reports its source', () => {
    const originalConfig = process.env.CAGENT_CONFIG
    const originalXdg = process.env.XDG_CONFIG_HOME
    process.env.CAGENT_CONFIG = '/tmp/custom-config.yaml'
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test'
    try {
      expect(resolveConfigPath()).toBe('/tmp/custom-config.yaml')
      expect(resolveConfigPathWithSource()).toEqual({
        path: '/tmp/custom-config.yaml',
        source: 'CAGENT_CONFIG',
      })
    } finally {
      if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = originalConfig
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = originalXdg
    }
  })

  it('uses XDG_CONFIG_HOME when CAGENT_CONFIG is unset', () => {
    const originalConfig = process.env.CAGENT_CONFIG
    const originalXdg = process.env.XDG_CONFIG_HOME
    delete process.env.CAGENT_CONFIG
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test'
    try {
      expect(resolveConfigPathWithSource()).toEqual({
        path: '/tmp/xdg-test/cagent/config.yaml',
        source: 'XDG_CONFIG_HOME',
      })
    } finally {
      if (originalConfig === undefined) delete process.env.CAGENT_CONFIG
      else process.env.CAGENT_CONFIG = originalConfig
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = originalXdg
    }
  })
})

describe('profile validation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cagent-profile-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function profileFile(profiles: string, defaultProfile?: string): string {
    const file = join(tmpDir, `profile-${Math.random()}.yaml`)
    const defaultLine = defaultProfile === undefined ? '' : `default_profile: ${defaultProfile}\n`
    writeFileSync(
      file,
      `${defaultLine}default_agent: opencode-go
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
multiplexer:
  default: herdr
  herdr: { enabled: true }
${profiles}`,
      'utf-8',
    )
    return file
  }

  it('loads named profiles with a defined default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n  frontier:\n    agent: codex\n    model: gpt-5.6-sol\n    effort: xhigh\n',
      'fast',
    )
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
  })

  it('rejects a default_profile that is not defined in profiles', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      'missing',
    )
    expect(() => loadConfig(file)).toThrow('default_profile "missing" is not defined in profiles')
  })

  it('rejects a default_profile without a profiles section', () => {
    const file = profileFile('', 'fast')
    expect(() => loadConfig(file)).toThrow('default_profile "fast" is not defined in profiles')
  })

  it('rejects an empty default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      '""',
    )
    expect(() => loadConfig(file)).toThrow('default_profile must not be empty')
  })

  it('accepts profiles without a default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
    )
    const config = loadConfig(file)
    expect(config.profiles?.fast).toBeDefined()
    expect(config.default_profile).toBeUndefined()
  })

  it('rejects a profile whose agent is not defined', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: unknown-agent\n    model: deepseek-v4-flash\n',
      'fast',
    )
    expect(() => loadConfig(file)).toThrow(
      'profile "fast".agent "unknown-agent" is not defined in agents',
    )
  })

  it('rejects an inherited Object.prototype profile agent', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: toString\n    model: deepseek-v4-flash\n',
      'fast',
    )
    expect(() => loadConfig(file)).toThrow(
      'profile "fast".agent "toString" is not defined in agents',
    )
  })

  it('rejects an inherited Object.prototype default_profile', () => {
    const file = profileFile(
      'profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      'toString',
    )
    expect(() => loadConfig(file)).toThrow('default_profile "toString" is not defined in profiles')
  })

  it('rejects a profile with an empty model', () => {
    const file = profileFile('profiles:\n  fast:\n    agent: opencode-go\n    model: ""\n', 'fast')
    expect(() => loadConfig(file)).toThrow('profile "fast".model must not be empty')
  })

  it('rejects a profile with a missing model', () => {
    const file = profileFile('profiles:\n  fast:\n    agent: opencode-go\n', 'fast')
    expect(() => loadConfig(file)).toThrow('profile "fast".model must be a string')
  })

  it('rejects an empty profile name', () => {
    const file = profileFile(
      'profiles:\n  "":\n    agent: opencode-go\n    model: deepseek-v4-flash\n',
      '""',
    )
    expect(() => loadConfig(file)).toThrow('profile name must not be empty')
  })

  it('rejects a profile entry that is not an object', () => {
    const file = profileFile('profiles:\n  fast: not-an-object\n', 'fast')
    expect(() => loadConfig(file)).toThrow('profile "fast" must be an object')
  })

  it('rejects profiles that are not an object', () => {
    const file = profileFile('profiles: [fast]')
    expect(() => loadConfig(file)).toThrow('profiles must be an object')
  })

  it.each([
    ['empty', '""', 'must not be empty'],
    ['numeric', '42', 'must be a string'],
    ['boolean', 'true', 'must be a string'],
    ['null', 'null', 'must be a string'],
  ])('rejects a %s profile effort', (_name, value, message) => {
    const file = profileFile(
      `profiles:\n  fast:\n    agent: opencode-go\n    model: deepseek-v4-flash\n    effort: ${value}\n`,
      'fast',
    )
    expect(() => loadConfig(file)).toThrow(`profile "fast".effort ${message}`)
  })
})

describe('config agent fields', () => {
  it('preserves model_id_prefix=false for Codex model IDs', () => {
    const file = join(tmpdir(), `cagent-codex-prefix-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: codex
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
multiplexer:
  default: herdr
`,
    )
    try {
      expect(loadConfig(file).agents.codex.model_id_prefix).toBe(false)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('allows switching the default agent', () => {
    const file = join(tmpdir(), `cagent-switch-${process.pid}.yaml`)
    writeFileSync(
      file,
      `default_agent: codex
agents:
  codex:
    bin: codex
    provider: codex
  opencode-go:
    bin: opencode
    provider: opencode-go
multiplexer:
  default: herdr
`,
    )
    try {
      const config = loadConfig(file)
      expect(config.default_agent).toBe('codex')
      expect(config.agents.codex.bin).toBe('codex')
    } finally {
      rmSync(file, { force: true })
    }
  })
})
