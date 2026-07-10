import type { Config, LevelConfig } from './config.js'

export interface ResolveOptions {
  cliModel?: string
  cliLevel?: string
  envModel?: string
  envLevel?: string
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

export function stripProvider(modelId: string, provider: string): string {
  const prefix = `${provider}/`
  if (modelId.startsWith(prefix)) {
    return modelId.slice(prefix.length)
  }
  return modelId
}

export function collectAllModels(config: Config): string[] {
  const seen = new Set<string>()
  for (const level of Object.values(config.levels)) {
    for (const model of level.models) {
      seen.add(model)
    }
  }
  return Array.from(seen)
}

export function collectAllFullModelIds(config: Config): string[] {
  const seen = new Set<string>()
  for (const level of Object.values(config.levels)) {
    for (const model of level.models) {
      seen.add(normalizeModelId(model, config.provider))
    }
  }
  return Array.from(seen)
}

export function isKnownModel(modelId: string, config: Config): boolean {
  const normalized = normalizeModelId(modelId, config.provider)
  const short = stripProvider(normalized, config.provider)

  for (const level of Object.values(config.levels)) {
    for (const model of level.models) {
      if (model === short || normalizeModelId(model, config.provider) === normalized) {
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
): { known: boolean; warning?: string } {
  if (isKnownModel(modelId, config)) {
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

export function listLevels(config: Config): string[] {
  return Object.keys(config.levels)
}

export function findSimilarLevel(input: string, config: Config): string | undefined {
  const levels = listLevels(config)
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

export function getLevel(config: Config, levelName: string): LevelConfig {
  const level = config.levels[levelName]
  if (!level) {
    const available = listLevels(config)
      .map((l) => `  ${l}`)
      .join('\n')
    const suggestion = findSimilarLevel(levelName, config)
    let message = `unknown level: ${levelName}\n\nAvailable levels:\n${available}`
    if (suggestion) {
      message += `\n\nDid you mean:\n  ${suggestion}`
    }
    throw new ModelError(message)
  }
  return level
}

export function findSimilarModel(input: string, config: Config): string | undefined {
  const models = collectAllModels(config)
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

  const hasExplicitModel = Boolean(options.cliModel || options.envModel)
  const effectiveLevel = options.cliLevel ?? options.envLevel

  let rawModel: string | undefined
  let levelName: string | undefined = effectiveLevel

  if (hasExplicitModel) {
    rawModel = options.cliModel ?? options.envModel
    // Explicit model must not fail on an unrelated invalid OCGO_LEVEL.
    // CLI-specified level is still validated.
    if (options.cliLevel !== undefined) {
      getLevel(config, options.cliLevel)
    }
  } else {
    levelName = effectiveLevel ?? config.default_level
    const level = getLevel(config, levelName)
    rawModel = level.default_model
  }

  if (!rawModel) {
    throw new ModelError(`could not resolve model for level "${levelName ?? config.default_level}"`)
  }

  const modelId = normalizeModelId(rawModel, config.provider)

  const validation = validateKnownModel(rawModel, config)
  if (!validation.known) {
    if (validation.warning) {
      warnings.push(validation.warning)
    } else {
      const suggestion = findSimilarModel(rawModel, config)
      let message = `unknown model in config: ${rawModel}`
      if (suggestion) {
        message += `\n\nDid you mean:\n  ${suggestion}`
      }
      throw new ModelError(message)
    }
  }

  return { modelId, levelName: effectiveLevel, warnings }
}
