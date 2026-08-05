import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'

export interface AgentConfig {
  bin: string
  provider: string
  /** Set false for CLIs, such as Codex, that expect raw model IDs. */
  model_id_prefix?: boolean
}
export interface MultiplexerAdapter {
  enabled: boolean
  start_command_template?: string
  run_command_template?: string
  note?: string
  [key: string]: unknown
}
export interface MultiplexerConfig {
  default: string
  [adapter: string]: string | MultiplexerAdapter | undefined
}

export interface LaunchProfile {
  agent: string
  model: string
  effort?: string
}

export interface ResolvedProfile {
  name: string
  source: 'cli' | 'env' | 'default'
  agent: string
  model: string
  effort?: string
  modelSource: 'cli' | 'env' | 'profile'
  effortSource?: 'cli' | 'env' | 'profile'
}

export interface Config {
  default_agent: string
  default_profile?: string
  agents: Record<string, AgentConfig>
  profiles?: Record<string, LaunchProfile>
  multiplexer: MultiplexerConfig
}

export type ConfigPathSource = 'CAGENT_CONFIG' | 'XDG_CONFIG_HOME' | 'HOME'

export interface ResolvedConfigPath {
  path: string
  source: ConfigPathSource
}

function getConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(process.env.HOME || homedir(), '.config')
}
export function configPath(): string {
  return join(getConfigHome(), 'cagent', 'config.yaml')
}

export function resolveConfigPathWithSource(): ResolvedConfigPath {
  if (process.env.CAGENT_CONFIG) {
    return { path: process.env.CAGENT_CONFIG, source: 'CAGENT_CONFIG' }
  }

  return {
    path: configPath(),
    source: process.env.XDG_CONFIG_HOME ? 'XDG_CONFIG_HOME' : 'HOME',
  }
}

export function resolveConfigPath(): string {
  return resolveConfigPathWithSource().path
}
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
function record(v: unknown, m: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ConfigError(m)
  return v as Record<string, unknown>
}
function string(v: unknown, m: string): string {
  if (typeof v !== 'string' || !v) throw new ConfigError(m)
  return v
}
function requiredNonEmptyString(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new ConfigError(`${name} must be a string`)
  if (!v) throw new ConfigError(`${name} must not be empty`)
  return v
}
function parseEffort(kind: string, name: string, effort: unknown): string | undefined {
  if (effort === undefined) return undefined
  if (effort === null || typeof effort === 'number' || typeof effort === 'boolean') {
    throw new ConfigError(`${kind} "${name}".effort must be a string`)
  }
  if (typeof effort === 'string') {
    if (effort === '') throw new ConfigError(`${kind} "${name}".effort must not be empty`)
    return effort
  }
  throw new ConfigError(`${kind} "${name}".effort must be a string`)
}

function parseProfiles(
  raw: unknown,
  agents: Record<string, AgentConfig>,
): Record<string, LaunchProfile> {
  const out: Record<string, LaunchProfile> = {}
  for (const [name, value] of Object.entries(record(raw, 'profiles must be an object'))) {
    if (!name) throw new ConfigError('profile name must not be empty')
    const profile = record(value, `profile "${name}" must be an object`)
    const agent = requiredNonEmptyString(profile.agent, `profile "${name}".agent`)
    if (!Object.hasOwn(agents, agent))
      throw new ConfigError(`profile "${name}".agent "${agent}" is not defined in agents`)
    out[name] = {
      agent,
      model: requiredNonEmptyString(profile.model, `profile "${name}".model`),
      effort: parseEffort('profile', name, profile.effort),
    }
  }
  return out
}
function mux(raw: unknown): MultiplexerConfig {
  const input = record(raw, 'multiplexer must be an object')
  const out: MultiplexerConfig = {
    default: string(input.default, 'multiplexer.default must be a string'),
  }
  for (const [name, value] of Object.entries(input))
    if (name !== 'default' && value != null) {
      const x = record(value, `multiplexer adapter "${name}" must be an object`)
      out[name] = {
        enabled: x.enabled === true,
        start_command_template:
          typeof x.start_command_template === 'string' ? x.start_command_template : undefined,
        run_command_template:
          typeof x.run_command_template === 'string' ? x.run_command_template : undefined,
        note: typeof x.note === 'string' ? x.note : undefined,
      }
    }
  return out
}
function rejectLegacyConfig(root: Record<string, unknown>): void {
  const legacyRootKeys = [
    'opencode_bin',
    'level',
    'levels',
    'default_level',
    'default_model',
    'models',
  ]
  if (legacyRootKeys.some((key) => key in root)) {
    throw new ConfigError(
      'legacy config format is unsupported; define agents and default_agent instead',
    )
  }

  if (!root.agents || typeof root.agents !== 'object' || Array.isArray(root.agents)) return

  for (const raw of Object.values(root.agents)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const agent = raw as Record<string, unknown>
    if (
      ['level', 'levels', 'default_level', 'default_model', 'models'].some((key) => key in agent)
    ) {
      throw new ConfigError(
        'legacy config format is unsupported; define agents and default_agent instead',
      )
    }
  }
}

function normalize(root: Record<string, unknown>): Config {
  rejectLegacyConfig(root)

  const multiplexer = mux(root.multiplexer)

  const agents: Record<string, AgentConfig> = {}
  for (const [id, raw] of Object.entries(record(root.agents, 'agents must be an object'))) {
    const agent = record(raw, `agent "${id}" must be an object`)
    agents[id] = {
      bin: string(agent.bin, `agent "${id}".bin must be a string`),
      provider: requiredNonEmptyString(agent.provider, `agent "${id}".provider`),
      model_id_prefix: agent.model_id_prefix !== false,
    }
  }

  const defaultAgent = string(root.default_agent, 'default_agent must be a string')
  const active = Object.hasOwn(agents, defaultAgent) ? agents[defaultAgent] : undefined
  if (!active) throw new ConfigError(`default_agent "${defaultAgent}" is not defined in agents`)

  const parsedProfiles =
    root.profiles !== undefined ? parseProfiles(root.profiles, agents) : undefined
  const defaultProfile =
    root.default_profile !== undefined
      ? requiredNonEmptyString(root.default_profile, 'default_profile')
      : undefined
  if (defaultProfile !== undefined && !Object.hasOwn(parsedProfiles ?? {}, defaultProfile))
    throw new ConfigError(`default_profile "${defaultProfile}" is not defined in profiles`)

  return {
    default_agent: defaultAgent,
    default_profile: defaultProfile,
    agents,
    profiles: parsedProfiles,
    multiplexer,
  }
}
export function loadConfig(path?: string): Config {
  const file = path ?? resolveConfigPath()
  let content: string
  try {
    content = readFileSync(file, 'utf-8')
  } catch (err) {
    throw new ConfigError(
      `config file not found: ${file}\n\n${err instanceof Error ? err.message : String(err)}`,
    )
  }
  try {
    return normalize(record(YAML.parse(content), 'config must be a YAML object'))
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(
      `failed to parse config YAML: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
export function getAgent(config: Config, id: string): AgentConfig {
  const agent = Object.hasOwn(config.agents, id) ? config.agents[id] : undefined
  if (agent) return agent
  throw new ConfigError(
    `unknown agent: ${id}\n\nAvailable agents:\n${Object.keys(config.agents)
      .map((name) => `  ${name}`)
      .join('\n')}`,
  )
}
