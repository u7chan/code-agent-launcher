import type { AgentConfig } from './config.js'

export interface ResolveOptions {
  agent?: string
  cliModel?: string
  envModel?: string
  cliEffort?: string
  envEffort?: string
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

function resolveProvider(agent: AgentConfig): string {
  if (agent.provider !== undefined) return agent.provider
  throw new ModelError(`agent "${agent.bin}" must define a provider`)
}

export function normalizeAgentModelId(modelId: string, agent: AgentConfig): string {
  const trimmed = modelId.trim()
  if (trimmed.length === 0) {
    throw new ModelError('model id is empty')
  }
  if (agent.model_id_prefix === false) {
    return stripProvider(trimmed, resolveProvider(agent))
  }
  return normalizeModelId(trimmed, resolveProvider(agent))
}

export function stripProvider(modelId: string, provider: string): string {
  const prefix = `${provider}/`
  if (modelId.startsWith(prefix)) {
    return modelId.slice(prefix.length)
  }
  return modelId
}

export function isProviderModel(modelId: string, provider: string): boolean {
  return modelId.startsWith(`${provider}/`)
}
