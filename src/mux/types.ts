import type { CommandSpec } from '../agents/types.js'

export type MuxMode = 'start' | 'run'

export type MuxStep = 'preflight' | 'current' | 'split' | 'dispatch'

export type MuxStepStatus = 'pass' | 'fail' | 'skip'

export interface MuxStepRecord {
  step: MuxStep
  status: MuxStepStatus
  pane_id?: string
  exit_code?: number | null
  error?: string
}

export interface MuxCommandSpec {
  executable: string
  args: string[]
  env: Record<string, string>
}

export interface MuxPanePlaceholder {
  value: string
  placeholder: true
}

export interface MuxPaneOperation {
  step: number
  action: 'get_current_pane' | 'split_pane' | 'run_in_pane'
  pane_id?: MuxPanePlaceholder
  created_pane_id?: MuxPanePlaceholder
  direction?: 'right'
  cwd?: string
  command?: MuxCommandSpec
  display_command?: string
}

export interface MuxExecutionPlan {
  command: MuxCommandSpec
  side_effects: readonly ('pane.current' | 'pane.split' | 'pane.run')[]
  placeholders: {
    current_pane_id: MuxPanePlaceholder
    created_pane_id: MuxPanePlaceholder
  }
  pane_operations: MuxPaneOperation[]
}

export interface MuxExecutionResult {
  adapter: string
  mode: MuxMode
  cwd: string
  current_pane_id?: string
  created_pane_id?: string
  command_dispatched: boolean
  task_completed: false
  failed_step?: MuxStep
  steps: MuxStepRecord[]
}

export interface MuxExecutionPlanResult extends MuxExecutionResult {
  agent?: string
  profile?: string
  model?: string
  effort?: string
  command: MuxCommandSpec
  plan: MuxExecutionPlan
  pane_operations: MuxPaneOperation[]
}

export function toMuxCommandSpec(command: CommandSpec): MuxCommandSpec {
  return {
    executable: command.command,
    args: [...command.args],
    env: { ...(command.env ?? {}) },
  }
}
