import type { CodingAgentAdapter } from './types.js'

export function serializeTomlString(value: string): string {
  let result = ''
  for (const ch of value) {
    switch (ch) {
      case '\\':
        result += '\\\\'
        break
      case '"':
        result += '\\"'
        break
      case '\b':
        result += '\\b'
        break
      case '\t':
        result += '\\t'
        break
      case '\n':
        result += '\\n'
        break
      case '\f':
        result += '\\f'
        break
      case '\r':
        result += '\\r'
        break
      default:
        if (ch <= '\x1F' || ch === '\x7F') {
          result += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
        } else {
          result += ch
        }
    }
  }
  return result
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
