import { type AgentConfig, type Config, getAgent, type LevelConfig } from './config.js'

export interface ResolveOptions {
  agent?: string
  cliModel?: string
  cliLevel?: string
  envModel?: string
  envLevel?: string
}

function agentConfig(config: Config, agent?: string) {
  return getAgent(config, agent ?? config.default_agent ?? 'opencode-go')
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelError'
  }
}

export function normalizeModelId(modelId: string, provider: string): string {
  const trimmed = modelId.trim()
  if (trimmed.length === 0) {
    throw new ModelError('model id is empty')
  }
  if (trimmed.includes('/')) {
    return trimmed
  }
  return `${provider}/${trimmed}`
}

export function normalizeAgentModelId(modelId: string, agent: AgentConfig): string {
  const trimmed = modelId.trim()
  if (trimmed.length === 0) {
    throw new ModelError('model id is empty')
  }
  if (agent.model_id_prefix === false) {
    return stripProvider(trimmed, agent.provider ?? 'opencode-go')
  }
  return normalizeModelId(trimmed, agent.provider ?? 'opencode-go')
}

export function stripProvider(modelId: string, provider: string): string {
  const prefix = `${provider}/`
  if (modelId.startsWith(prefix)) {
    return modelId.slice(prefix.length)
  }
  return modelId
}

export function collectAllModels(config: Config, agent?: string): string[] {
  const seen = new Set<string>()
  for (const level of Object.values(agentConfig(config, agent).levels)) {
    for (const model of level.models) {
      seen.add(model)
    }
  }
  return Array.from(seen)
}

export function collectAllFullModelIds(config: Config, agent?: string): string[] {
  const seen = new Set<string>()
  const selected = agentConfig(config, agent)
  for (const level of Object.values(selected.levels)) {
    for (const model of level.models) {
      seen.add(normalizeAgentModelId(model, selected))
    }
  }
  return Array.from(seen)
}

export function isKnownModel(modelId: string, config: Config, agent?: string): boolean {
  const selected = agentConfig(config, agent)
  const provider = selected.provider ?? 'opencode-go'
  const normalized = normalizeAgentModelId(modelId, selected)
  const short = stripProvider(normalized, provider)

  for (const level of Object.values(selected.levels)) {
    for (const model of level.models) {
      if (model === short || normalizeAgentModelId(model, selected) === normalized) {
        return true
      }
    }
  }

  return false
}

export function isProviderModel(modelId: string, provider: string): boolean {
  return modelId.startsWith(`${provider}/`)
}

export function validateKnownModel(
  modelId: string,
  config: Config,
  agent?: string,
): { known: boolean; warning?: string } {
  if (isKnownModel(modelId, config, agent)) {
    return { known: true }
  }

  if (modelId.includes('/')) {
    return {
      known: false,
      warning: `unknown model: ${modelId} (full id allowed but not listed in config)`,
    }
  }

  return { known: false }
}

export function listLevels(config: Config, agent?: string): string[] {
  return Object.keys(agentConfig(config, agent).levels)
}

export function findSimilarLevel(
  input: string,
  config: Config,
  agent?: string,
): string | undefined {
  const levels = listLevels(config, agent)
  let best: string | undefined
  let bestDistance = Infinity

  for (const level of levels) {
    const distance = levenshteinDistance(input.toLowerCase(), level.toLowerCase())
    if (distance < bestDistance && distance <= Math.max(2, level.length / 3)) {
      bestDistance = distance
      best = level
    }
  }

  return best
}

export function getLevel(config: Config, levelName: string, agent?: string): LevelConfig {
  const level = agentConfig(config, agent).levels[levelName]
  if (!level) {
    const available = listLevels(config, agent)
      .map((l) => `  ${l}`)
      .join('\n')
    const suggestion = findSimilarLevel(levelName, config, agent)
    let message = `unknown level: ${levelName}\n\nAvailable levels:\n${available}`
    if (suggestion) {
      message += `\n\nDid you mean:\n  ${suggestion}`
    }
    throw new ModelError(message)
  }
  return level
}

export function findSimilarModel(
  input: string,
  config: Config,
  agent?: string,
): string | undefined {
  const models = collectAllModels(config, agent)
  let best: string | undefined
  let bestDistance = Infinity

  for (const model of models) {
    const distance = levenshteinDistance(input.toLowerCase(), model.toLowerCase())
    if (distance < bestDistance && distance <= Math.max(3, model.length / 3)) {
      bestDistance = distance
      best = model
    }
  }

  return best
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[b.length][a.length]
}

export function resolveModel(
  config: Config,
  options: ResolveOptions,
): { modelId: string; levelName?: string; warnings: string[] } {
  const warnings: string[] = []
  const selected = agentConfig(config, options.agent)

  const hasExplicitModel = Boolean(options.cliModel || options.envModel)
  const effectiveLevel = options.cliLevel ?? options.envLevel

  let rawModel: string | undefined
  let levelName: string | undefined = effectiveLevel

  if (hasExplicitModel) {
    rawModel = options.cliModel ?? options.envModel
    // An explicit model must not fail on an unrelated environment level.
    // CLI-specified level is still validated.
    if (options.cliLevel !== undefined) {
      getLevel(config, options.cliLevel, options.agent)
    }
  } else {
    levelName = effectiveLevel ?? config.default_level
    const level = getLevel(config, levelName, options.agent)
    rawModel = level.default_model
  }

  if (!rawModel) {
    throw new ModelError(`could not resolve model for level "${levelName ?? config.default_level}"`)
  }

  const modelId = normalizeAgentModelId(rawModel, selected)

  const validation = validateKnownModel(rawModel, config, options.agent)
  if (!validation.known) {
    if (validation.warning) {
      warnings.push(validation.warning)
    } else {
      const suggestion = findSimilarModel(rawModel, config, options.agent)
      let message = `unknown model in config: ${rawModel}`
      if (suggestion) {
        message += `\n\nDid you mean:\n  ${suggestion}`
      }
      throw new ModelError(message)
    }
  }

  return { modelId, levelName: effectiveLevel, warnings }
}
