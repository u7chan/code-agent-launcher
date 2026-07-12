import type { CodingAgentAdapter } from './types.js'

export function serializeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

function buildEffortConfigArg(effort: string): string {
  return `model_reasoning_effort="${serializeTomlString(effort)}"`
}

export const codexAdapter: CodingAgentAdapter = {
  id: 'codex',
  displayName: 'Codex',
  defaultBin: 'codex',
  buildRunCommand: ({ bin, modelId, effort, extraArgs }) => {
    const args: string[] = ['exec']
    if (modelId) args.push('--model', modelId)
    if (effort) args.push('-c', buildEffortConfigArg(effort))
    args.push(...extraArgs)
    return { command: bin, args }
  },
  buildStartCommand: ({ bin, modelId, effort, extraArgs }) => {
    const args: string[] = []
    if (modelId) args.push('--model', modelId)
    if (effort) args.push('-c', buildEffortConfigArg(effort))
    args.push(...extraArgs)
    return { command: bin, args }
  },
}
