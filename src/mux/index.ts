import { Command } from 'commander'
import { getAgentAdapter } from '../agents/registry.js'
import type { CommandSpec } from '../agents/types.js'
import { formatCommandSpecForShell } from '../command.js'
import {
  type Config,
  configPath,
  getAgent,
  loadConfig,
  type MultiplexerAdapter,
} from '../config.js'
import { isJsonMode, type JsonWarning, outputJsonSuccess } from '../json-output.js'
import { resolveModel } from '../model.js'
import { executeHerdrRun, executeHerdrStart } from './herdr.js'
import { executeTmuxRun, executeTmuxStart } from './tmux.js'

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

export function validateMuxAdapter(config: Config, adapterName: string): MultiplexerAdapter {
  const adapter = config.multiplexer[adapterName]
  if (!adapter || typeof adapter !== 'object' || !(adapter as MultiplexerAdapter).enabled) {
    throw new MuxAdapterError(
      `multiplexer adapter is not enabled: ${adapterName}\n\nCheck:\n  ${
        process.env.CAGENT_CONFIG ?? configPath()
      }`,
    )
  }
  return adapter as MultiplexerAdapter
}

interface ResolvedMuxCommand {
  adapterName: string
  commandSpec: CommandSpec
  agentId: string
  resolved: ReturnType<typeof resolveModel>
  warnings: JsonWarning[]
}

function resolveMuxCommandWithMetadata(
  config: Config,
  mode: 'start' | 'run',
  level: string,
  muxOpts: MuxGlobalOptions,
  extraArgs: string[],
): ResolvedMuxCommand {
  const adapterName = muxOpts.adapter ?? config.multiplexer.default

  validateMuxAdapter(config, adapterName)

  const agentId = muxOpts.agent ?? process.env.CAGENT_AGENT ?? config.default_agent
  const resolved = resolveModel(config, {
    cliModel: muxOpts.model,
    cliLevel: level,
    cliEffort: muxOpts.effort,
    agent: agentId,
    envModel: process.env.CAGENT_MODEL,
    envLevel: process.env.CAGENT_LEVEL,
    envEffort: process.env.CAGENT_EFFORT,
  })

  const warnings: JsonWarning[] = []
  const json = muxOpts.dryRun === true && isJsonMode(muxOpts)
  for (const warning of resolved.warnings) {
    if (json) {
      warnings.push({
        code: 'UNKNOWN_MODEL',
        message: warning,
        details: { model: resolved.modelId },
      })
    } else {
      console.warn(`Warning: ${warning}`)
    }
  }

  if (mode === 'start' && agentId === 'opencode-go' && resolved.effort) {
    throw new MuxAdapterError(
      'OpenCode interactive mode does not support reasoning effort. Use `cagent run` with --effort instead.',
    )
  }

  const agent = getAgent(config, agentId)
  const codingAdapter = getAgentAdapter(agentId)
  const context = {
    bin: agent.bin,
    modelId: resolved.modelId,
    level,
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
  level: string,
  muxOpts: MuxGlobalOptions,
  extraArgs: string[],
): { adapterName: string; commandSpec: CommandSpec } {
  const { adapterName, commandSpec } = resolveMuxCommandWithMetadata(
    config,
    mode,
    level,
    muxOpts,
    extraArgs,
  )
  return { adapterName, commandSpec }
}

async function dispatchMux(mode: 'start' | 'run', level: string, command: Command): Promise<void> {
  const muxOpts = command.optsWithGlobals() as MuxGlobalOptions
  const config = loadConfig()
  const extraArgs = command.args.slice(1)

  const { adapterName, commandSpec, agentId, resolved, warnings } = resolveMuxCommandWithMetadata(
    config,
    mode,
    level,
    muxOpts,
    extraArgs,
  )

  const cwd = process.cwd()
  const dryRun = muxOpts.dryRun === true

  if (dryRun && isJsonMode(muxOpts)) {
    const data: {
      adapter: string
      mode: 'start' | 'run'
      agent: string
      level: string
      model: string
      effort?: string
      command: { executable: string; args: string[]; env: Record<string, string> }
      pane_operations?: Array<Record<string, unknown>>
    } = {
      adapter: adapterName,
      mode,
      agent: agentId,
      level: resolved.levelName ?? level,
      model: resolved.modelId,
      effort: resolved.effort,
      command: {
        executable: commandSpec.command,
        args: commandSpec.args,
        env: commandSpec.env ?? {},
      },
    }
    if (adapterName === 'herdr') {
      data.pane_operations = [
        { step: 1, action: 'get_current_pane', description: 'get current pane ID' },
        { step: 2, action: 'split_pane', direction: 'right', cwd },
        {
          step: 3,
          action: 'run_in_pane',
          command: formatCommandSpecForShell(commandSpec),
        },
      ]
    }
    outputJsonSuccess(`mux.${mode}.plan`, data, warnings)
    return
  }

  if (adapterName === 'herdr') {
    const ctx = {
      command: commandSpec,
      cwd,
      extraArgs,
      dryRun,
    }
    if (mode === 'start') {
      executeHerdrStart(ctx)
    } else {
      executeHerdrRun(ctx)
    }
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

export function createMuxCommand(): Command {
  const mux = new Command('mux')

  mux.description('Launch a coding agent via a multiplexer adapter')
  mux.option('-a, --agent <agent>', 'coding agent id')

  const start = new Command('start')
    .description('Start an interactive coding-agent session in a new pane')
    .argument('<level>', 'task level (low, mid, high, etc.)')
    .allowUnknownOption()
    .action(async (level: string) => {
      await dispatchMux('start', level, start)
    })

  const run = new Command('run')
    .description('Run a coding agent non-interactively in a new pane')
    .argument('<level>', 'task level (low, mid, high, etc.)')
    .allowUnknownOption()
    .action(async (level: string) => {
      await dispatchMux('run', level, run)
    })

  mux.addCommand(start)
  mux.addCommand(run)

  return mux
}
