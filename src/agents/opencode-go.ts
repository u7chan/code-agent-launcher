import type { AgentConfig } from '../config.js'
import { normalizeModelId } from '../model.js'
import type { CodingAgentAdapter } from './types.js'

function launchModelId(modelId: string | undefined, config: AgentConfig): string | undefined {
  if (modelId === undefined) return undefined
  if (config.model_id_prefix === false) return modelId
  return normalizeModelId(modelId, config.provider)
}

export class OpenCodeStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenCodeStartError'
  }
}

export const opencodeGoAdapter: CodingAgentAdapter = {
  id: 'opencode-go',
  displayName: 'OpenCode Go',
  defaultBin: 'opencode',
  buildRunCommand: ({ bin, modelId, effort, extraArgs, config }) => {
    const args: string[] = ['run']
    const effectiveModelId = launchModelId(modelId, config)
    if (effectiveModelId) args.push('--model', effectiveModelId)
    if (effort) args.push('--variant', effort)
    args.push(...extraArgs)
    return { command: bin, args }
  },
  buildStartCommand: ({ bin, modelId, effort, extraArgs, config }) => {
    if (effort) {
      throw new OpenCodeStartError(
        'OpenCode interactive mode does not support reasoning effort. Use `cagent run` with --effort instead.',
      )
    }
    const args: string[] = []
    const effectiveModelId = launchModelId(modelId, config)
    if (effectiveModelId) args.push('--model', effectiveModelId)
    args.push(...extraArgs)
    return { command: bin, args }
  },
  buildModelListCommand: ({ bin, provider, refresh }) => {
    const args = ['models', provider]
    if (refresh) args.push('--refresh')
    return { command: bin, args }
  },
}
