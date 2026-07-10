import type { CodingAgentAdapter } from './types.js'
export const opencodeGoAdapter: CodingAgentAdapter = {
  id: 'opencode-go',
  displayName: 'OpenCode Go',
  defaultBin: 'opencode',
  buildRunCommand: ({ bin, modelId, extraArgs }) => ({
    command: bin,
    args: ['run', ...(modelId ? ['--model', modelId] : []), ...extraArgs],
  }),
  buildStartCommand: ({ bin, modelId, extraArgs }) => ({
    command: bin,
    args: [...(modelId ? ['--model', modelId] : []), ...extraArgs],
  }),
}
