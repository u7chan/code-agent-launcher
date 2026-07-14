import { Command } from 'commander'
import { getAgentAdapter } from '../agents/registry.js'
import type { CommandSpec } from '../agents/types.js'
import {
  type Config,
  configPath,
  getAgent,
  loadConfig,
  type MultiplexerAdapter,
} from '../config.js'
import { resolveModel } from '../model.js'
import { executeHerdrRun, executeHerdrStart } from './herdr.js'
import { executeTmuxRun, executeTmuxStart } from './tmux.js'

export interface MuxGlobalOptions {
  model?: string
  effort?: string
  adapter?: string
  dryRun?: boolean
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

export function resolveMuxCommand(
  config: Config,
  mode: 'start' | 'run',
  level: string,
  muxOpts: MuxGlobalOptions,
  extraArgs: string[],
): { adapterName: string; commandSpec: CommandSpec } {
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

  for (const warning of resolved.warnings) {
    console.warn(`Warning: ${warning}`)
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

  return { adapterName, commandSpec }
}

async function dispatchMux(mode: 'start' | 'run', level: string, command: Command): Promise<void> {
  const muxOpts = command.optsWithGlobals() as MuxGlobalOptions
  const config = loadConfig()
  const extraArgs = command.args.slice(1)

  const { adapterName, commandSpec } = resolveMuxCommand(config, mode, level, muxOpts, extraArgs)

  const cwd = process.cwd()
  const dryRun = muxOpts.dryRun === true

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
