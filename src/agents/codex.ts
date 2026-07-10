import type { CodingAgentAdapter } from './types.js'

/** Basic built-in adapter; agent-specific options can be extended without changing the CLI core. */
export const codexAdapter: CodingAgentAdapter = {
  id: 'codex',
  displayName: 'Codex',
  defaultBin: 'codex',
  buildRunCommand: ({ bin, modelId, extraArgs }) => ({
    command: bin,
    args: ['exec', ...(modelId ? ['--model', modelId] : []), ...extraArgs],
  }),
  buildStartCommand: ({ bin, modelId, extraArgs }) => ({
    command: bin,
    args: [...(modelId ? ['--model', modelId] : []), ...extraArgs],
  }),
}
