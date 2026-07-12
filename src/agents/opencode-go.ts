import type { CodingAgentAdapter } from './types.js'

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
  buildRunCommand: ({ bin, modelId, effort, extraArgs }) => {
    const args: string[] = ['run']
    if (modelId) args.push('--model', modelId)
    if (effort) args.push('--variant', effort)
    args.push(...extraArgs)
    return { command: bin, args }
  },
  buildStartCommand: ({ bin, modelId, effort, extraArgs }) => {
    if (effort) {
      throw new OpenCodeStartError(
        'OpenCode interactive mode does not support reasoning effort. Use `cagent run` with --effort instead.',
      )
    }
    const args: string[] = []
    if (modelId) args.push('--model', modelId)
    args.push(...extraArgs)
    return { command: bin, args }
  },
}
