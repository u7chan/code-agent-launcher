import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'

export interface LevelConfig {
  description: string
  default_model: string
  models: string[]
}
export interface AgentConfig {
  bin: string
  provider?: string
  /** Set false for CLIs, such as Codex, that expect raw model IDs. */
  model_id_prefix?: boolean
  levels: Record<string, LevelConfig>
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

/** Normalized v2 configuration. Legacy fields are retained for API compatibility. */
export interface Config {
  version: number
  default_agent?: string
  default_level: string
  agents?: Record<string, AgentConfig>
  multiplexer: MultiplexerConfig
  opencode_bin: string
  provider: string
  levels: Record<string, LevelConfig>
}

function getConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}
export function configPath(): string {
  return join(getConfigHome(), 'cagent', 'config.yaml')
}
export function resolveConfigPath(): string {
  if (process.env.CAGENT_CONFIG) return process.env.CAGENT_CONFIG
  return configPath()
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
function levels(raw: unknown): Record<string, LevelConfig> {
  const out: Record<string, LevelConfig> = {}
  for (const [name, value] of Object.entries(record(raw, 'levels must be an object'))) {
    const level = record(value, `level "${name}" must be an object`)
    if (!Array.isArray(level.models) || !level.models.every((x) => typeof x === 'string'))
      throw new ConfigError(`level "${name}".models must be an array of strings`)
    out[name] = {
      description: string(level.description, `level "${name}".description must be a string`),
      default_model: string(level.default_model, `level "${name}".default_model must be a string`),
      models: level.models as string[],
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
function normalize(root: Record<string, unknown>): Config {
  const version = typeof root.version === 'number' ? root.version : 1
  const multiplexer = mux(root.multiplexer)
  let agents: Record<string, AgentConfig>
  let defaultAgent: string
  if (version >= 2) {
    agents = {}
    for (const [id, raw] of Object.entries(record(root.agents, 'agents must be an object'))) {
      const agent = record(raw, `agent "${id}" must be an object`)
      agents[id] = {
        bin: string(agent.bin, `agent "${id}".bin must be a string`),
        provider: typeof agent.provider === 'string' ? agent.provider : undefined,
        model_id_prefix: agent.model_id_prefix !== false,
        levels: levels(agent.levels),
      }
    }
    defaultAgent = string(root.default_agent, 'default_agent must be a string')
  } else {
    defaultAgent = 'opencode-go'
    agents = {
      'opencode-go': {
        bin: string(root.opencode_bin, 'opencode_bin must be a string'),
        provider: string(root.provider, 'provider must be a string'),
        model_id_prefix: true,
        levels: levels(root.levels),
      },
    }
  }
  const active = agents[defaultAgent]
  if (!active) throw new ConfigError(`default_agent "${defaultAgent}" is not defined in agents`)
  const defaultLevel = string(root.default_level, 'default_level must be a string')
  if (!active.levels[defaultLevel])
    throw new ConfigError(
      `default_level "${defaultLevel}" is not defined in levels for agent "${defaultAgent}"`,
    )
  return {
    version: 2,
    default_agent: defaultAgent,
    default_level: defaultLevel,
    agents,
    multiplexer,
    opencode_bin: active.bin,
    provider: active.provider ?? 'opencode-go',
    levels: active.levels,
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
  const agents = config.agents ?? {
    'opencode-go': { bin: config.opencode_bin, provider: config.provider, levels: config.levels },
  }
  const agent = agents[id]
  if (agent) return agent
  throw new ConfigError(
    `unknown agent: ${id}\n\nAvailable agents:\n${Object.keys(agents)
      .map((name) => `  ${name}`)
      .join('\n')}`,
  )
}
