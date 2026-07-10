import { Command, Option } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { getAgent, loadConfig } from './config.js'
import { resolveModel } from './model.js'

export interface MainOptions {
  level?: string
  model?: string
  dryRun?: boolean
  adapter?: string
  agent?: string
}

export function createMainCommand(): Command {
  const program = new Command()

  program
    .name('cagent')
    .description('Coding-agent launcher with model routing')
    .version('0.1.0')
    .argument('[level]', 'task level (low, mid, high, etc.)')
    .option('-l, --level <level>', 'task level')
    .option('-m, --model <model>', 'explicit model id')
    .option('-a, --agent <agent>', 'coding agent id')
    .option('-d, --dry-run', 'print the opencode command without executing')
    .addOption(
      new Option('-a, --adapter <adapter>', 'multiplexer adapter to use')
        .default(undefined)
        .hideHelp(),
    )
    .allowUnknownOption()
    .action(async (positionalLevel: string | undefined, options: MainOptions) => {
      const cliLevel = options.level ?? positionalLevel
      const cliModel = options.model
      const envModel = process.env.CAGENT_MODEL ?? process.env.OCGO_MODEL
      const envLevel = process.env.CAGENT_LEVEL ?? process.env.OCGO_LEVEL

      const config = loadConfig()
      const agentId =
        options.agent ?? process.env.CAGENT_AGENT ?? config.default_agent ?? 'opencode-go'
      const agent = getAgent(config, agentId)
      const adapter = getAgentAdapter(agentId)
      const resolved = resolveModel(config, {
        agent: agentId,
        cliModel,
        cliLevel,
        envModel,
        envLevel,
      })

      for (const warning of resolved.warnings) {
        console.warn(`Warning: ${warning}`)
      }

      const extraArgs = program.args.slice(positionalLevel !== undefined ? 1 : 0)
      const spec =
        adapter.buildStartCommand?.({
          bin: agent.bin,
          modelId: resolved.modelId,
          level: resolved.levelName ?? config.default_level,
          cwd: process.cwd(),
          extraArgs,
          config: agent,
        }) ??
        adapter.buildRunCommand({
          bin: agent.bin,
          modelId: resolved.modelId,
          level: resolved.levelName ?? config.default_level,
          cwd: process.cwd(),
          extraArgs,
          config: agent,
        })

      if (options.dryRun) {
        console.log(`# Resolved level: ${resolved.levelName ?? config.default_level}`)
        console.log(formatCommandSpec(spec))
        return
      }

      const result = await runCommandSpec(spec, {
        stdio: 'inherit',
      })

      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode)
      }
    })

  return program
}

export async function main(argv: string[]): Promise<void> {
  const program = createMainCommand()
  await program.parseAsync(argv)
}
