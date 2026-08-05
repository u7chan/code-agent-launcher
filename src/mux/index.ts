import { Command } from 'commander'
import { getAgentAdapter } from '../agents/registry.js'
import type { CommandSpec } from '../agents/types.js'
import {
  type Config,
  getAgent,
  loadConfig,
  type MultiplexerAdapter,
  type ResolvedProfile,
  resolveConfigPath,
} from '../config.js'
import {
  isJsonMode,
  type JsonWarning,
  outputJsonFailure,
  outputJsonSuccess,
} from '../json-output.js'
import { resolveProfile } from '../profile.js'
import { executeHerdrRun, executeHerdrStart, type HerdrContext } from './herdr.js'
import { executeTmuxRun, executeTmuxStart } from './tmux.js'
import type { MuxExecutionPlanResult, MuxExecutionResult } from './types.js'

export interface MuxGlobalOptions {
  model?: string
  effort?: string
  adapter?: string
  dryRun?: boolean
  json?: boolean
  agent?: string
}

export class MuxAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MuxAdapterError'
  }
}

export class MuxExecutionError extends MuxAdapterError {
  readonly result: MuxExecutionResult
  readonly operation: string
  readonly outputRendered: boolean

  constructor(result: MuxExecutionResult, outputRendered: boolean) {
    const failedStep = result.steps.find((step) => step.step === result.failed_step)
    super(failedStep?.error ?? `mux ${result.mode} failed at ${result.failed_step ?? 'unknown'}`)
    this.name = 'MuxExecutionError'
    this.result = result
    this.operation = `mux.${result.mode}`
    this.outputRendered = outputRendered
  }
}

export function validateMuxAdapter(config: Config, adapterName: string): MultiplexerAdapter {
  const adapter = config.multiplexer[adapterName]
  if (!adapter || typeof adapter !== 'object' || !(adapter as MultiplexerAdapter).enabled) {
    throw new MuxAdapterError(
      `multiplexer adapter is not enabled: ${adapterName}\n\nCheck:\n  ${resolveConfigPath()}`,
    )
  }
  return adapter as MultiplexerAdapter
}

interface ResolvedMuxCommand {
  adapterName: string
  commandSpec: CommandSpec
  agentId: string
  resolved: ResolvedProfile
  warnings: JsonWarning[]
}

function resolveMuxCommandWithMetadata(
  config: Config,
  mode: 'start' | 'run',
  profile: string,
  muxOpts: MuxGlobalOptions,
  extraArgs: string[],
): ResolvedMuxCommand {
  const adapterName = muxOpts.adapter ?? config.multiplexer.default

  validateMuxAdapter(config, adapterName)

  const resolved = resolveProfile(config, {
    cliProfile: profile,
    cliModel: muxOpts.model,
    cliEffort: muxOpts.effort,
    envProfile: process.env.CAGENT_PROFILE,
    envModel: process.env.CAGENT_MODEL,
    envEffort: process.env.CAGENT_EFFORT,
  })

  const agentId = resolved.agent
  const warnings: JsonWarning[] = []

  if (mode === 'start' && agentId === 'opencode-go' && resolved.effort) {
    throw new MuxAdapterError(
      'OpenCode interactive mode does not support reasoning effort. Use `cagent run` with --effort instead.',
    )
  }

  const agent = getAgent(config, agentId)
  const codingAdapter = getAgentAdapter(agentId)
  const context = {
    bin: agent.bin,
    modelId: resolved.model,
    level: resolved.name,
    cwd: process.cwd(),
    extraArgs,
    config: agent,
    effort: resolved.effort,
  }
  const commandSpec =
    mode === 'start'
      ? (codingAdapter.buildStartCommand?.(context) ?? codingAdapter.buildRunCommand(context))
      : codingAdapter.buildRunCommand(context)

  return { adapterName, commandSpec, agentId, resolved, warnings }
}

export function resolveMuxCommand(
  config: Config,
  mode: 'start' | 'run',
  profile: string,
  muxOpts: MuxGlobalOptions,
  extraArgs: string[],
): { adapterName: string; commandSpec: CommandSpec } {
  const { adapterName, commandSpec } = resolveMuxCommandWithMetadata(
    config,
    mode,
    profile,
    muxOpts,
    extraArgs,
  )
  return { adapterName, commandSpec }
}

async function dispatchMux(
  mode: 'start' | 'run',
  profile: string,
  command: Command,
): Promise<void> {
  const muxOpts = command.optsWithGlobals() as MuxGlobalOptions
  const config = loadConfig()
  const extraArgs = command.args.slice(1)

  const { adapterName, commandSpec, agentId, resolved, warnings } = resolveMuxCommandWithMetadata(
    config,
    mode,
    profile,
    muxOpts,
    extraArgs,
  )

  const cwd = process.cwd()
  const dryRun = muxOpts.dryRun === true

  if (adapterName === 'herdr') {
    const ctx: HerdrContext = {
      command: commandSpec,
      cwd,
      extraArgs,
      dryRun,
    }

    const result = mode === 'start' ? executeHerdrStart(ctx) : executeHerdrRun(ctx)
    if (dryRun) {
      const plan = result as MuxExecutionPlanResult
      const data: MuxExecutionPlanResult = {
        ...plan,
        agent: agentId,
        level: resolved.name,
        model: resolved.model,
        effort: resolved.effort,
      }
      if (isJsonMode(muxOpts)) {
        outputJsonSuccess(`mux.${mode}.plan`, data, warnings)
      } else {
        printMuxDryRunPlan(data)
      }
      return
    }

    reportMuxResult(result, muxOpts, warnings)
    return
  }

  if (adapterName === 'tmux') {
    const ctx = {
      command: commandSpec,
      cwd,
      extraArgs,
      dryRun,
    }
    if (mode === 'start') {
      executeTmuxStart(ctx)
    } else {
      executeTmuxRun(ctx)
    }
    return
  }

  throw new MuxAdapterError(`unknown multiplexer adapter: ${adapterName}`)
}

function failedStepMessage(result: MuxExecutionResult): string {
  const failedStep = result.steps.find((step) => step.step === result.failed_step)
  return failedStep?.error ?? `mux ${result.mode} failed at ${result.failed_step ?? 'unknown'}`
}

export function printMuxDryRunPlan(plan: MuxExecutionPlanResult): void {
  console.log('# Herdr dry-run command sequence:')
  console.log('No Herdr command was invoked.')
  console.log('herdr pane current --current')
  console.log(`herdr pane split --pane <current-pane> --direction right --cwd ${plan.cwd}`)
  console.log(`herdr pane run <created-pane> ${plan.pane_operations[2]?.display_command ?? ''}`)
  console.log('Pane IDs shown in this plan are placeholders, not resource IDs.')
}

export function printMuxExecutionSuccess(result: MuxExecutionResult): void {
  console.log(`Created pane: ${result.created_pane_id ?? '<unknown>'}`)
  console.log('Dispatched agent command: yes')
  console.log('Task completion: not observed by cagent')
}

export function printMuxExecutionFailure(result: MuxExecutionResult): void {
  console.error(`Error: ${failedStepMessage(result)}`)
  console.error('')
  if (result.created_pane_id) {
    console.error('Created pane:')
    console.error(`  ${result.created_pane_id}`)
    console.error('')
  }
  console.error('Failed step:')
  console.error(`  ${result.failed_step ?? 'unknown'}`)
  if (result.created_pane_id) {
    console.error('')
    console.error('The pane was not closed automatically because command state may be ambiguous.')
    console.error('Inspect it with:')
    console.error(`  herdr pane get ${result.created_pane_id}`)
    console.error('')
    console.error('Close it after inspection with:')
    console.error(`  herdr pane close ${result.created_pane_id}`)
  }
  console.error('')
  console.error('Task completion: not observed by cagent')
}

function muxResultDetails(result: MuxExecutionResult): Record<string, unknown> {
  return { ...result }
}

function reportMuxResult(
  result: MuxExecutionResult,
  muxOpts: MuxGlobalOptions,
  warnings: JsonWarning[],
): void {
  if (result.failed_step) {
    if (isJsonMode(muxOpts)) {
      outputJsonFailure(
        `mux.${result.mode}`,
        'MUX_EXECUTION_FAILED',
        failedStepMessage(result),
        muxResultDetails(result),
        'Inspect the created pane before retrying or closing it.',
      )
    } else {
      printMuxExecutionFailure(result)
    }
    throw new MuxExecutionError(result, true)
  }

  if (isJsonMode(muxOpts)) {
    outputJsonSuccess(`mux.${result.mode}`, result, warnings)
  } else {
    printMuxExecutionSuccess(result)
  }
}

export function createMuxCommand(): Command {
  const mux = new Command('mux')

  mux.description('Launch a coding agent via a multiplexer adapter')
  mux.option('-a, --agent <agent>', 'coding agent id')

  const start = new Command('start')
    .description('Start an interactive coding-agent session in a new pane')
    .argument('<profile>', 'launch profile')
    .allowUnknownOption()
    .action(async (profile: string) => {
      await dispatchMux('start', profile, start)
    })

  const run = new Command('run')
    .description('Run a coding agent non-interactively in a new pane')
    .argument('<profile>', 'launch profile')
    .allowUnknownOption()
    .action(async (profile: string) => {
      await dispatchMux('run', profile, run)
    })

  mux.addCommand(start)
  mux.addCommand(run)

  return mux
}
