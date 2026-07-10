import { codexAdapter } from './codex.js'
import { opencodeGoAdapter } from './opencode-go.js'
import type { CodingAgentAdapter } from './types.js'
const adapters: Record<string, CodingAgentAdapter> = {
  'opencode-go': opencodeGoAdapter,
  codex: codexAdapter,
}
export function getAgentAdapter(id: string): CodingAgentAdapter {
  const adapter = adapters[id]
  if (adapter) return adapter
  throw new Error(
    `unknown agent: ${id}\n\nAvailable agents:\n${Object.keys(adapters)
      .map((name) => `  ${name}`)
      .join('\n')}`,
  )
}
export function listAgentAdapters(): CodingAgentAdapter[] {
  return Object.values(adapters)
}
