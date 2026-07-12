import type { AgentConfig } from '../config.js'
export interface CommandSpec {
  command: string
  args: string[]
  env?: Record<string, string>
}
export interface BuildAgentCommandContext {
  bin: string
  modelId?: string
  level: string
  cwd: string
  extraArgs: string[]
  config: AgentConfig
  effort?: string
}
export interface CodingAgentAdapter {
  id: string
  displayName: string
  defaultBin: string
  buildRunCommand(context: BuildAgentCommandContext): CommandSpec
  buildStartCommand?(context: BuildAgentCommandContext): CommandSpec
}
