import { Command, Option } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { getAgent, loadConfig } from './config.js'
import { resolveModel } from './model.js'
import { VERSION } from './version.js'

export interface MainOptions {
  level?: string
  model?: string
  effort?: string
  dryRun?: boolean
  adapter?: string
  agent?: string
}

export function createMainCommand(): Command {
  const program = new Command()

  program
    .name('cagent')
    .description('Coding-agent launcher with model routing')
    .version(VERSION)
    .argument('[level]', 'task level (low, mid, high, etc.)')
    .option('-l, --level <level>', 'task level')
    .option('-m, --model <model>', 'explicit model id')
    .option('-e, --effort <effort>', 'explicit reasoning effort')
    .option('-a, --agent <agent>', 'coding agent id')
    .option('-d, --dry-run', 'print the resolved command without executing')
    .addOption(
      new Option('--adapter <adapter>', 'multiplexer adapter to use').default(undefined).hideHelp(),
    )
    .allowUnknownOption()
    .action(async (positionalLevel: string | undefined, options: MainOptions) => {
      const cliLevel = options.level ?? positionalLevel
      const cliModel = options.model
      const cliEffort = options.effort
      const envModel = process.env.CAGENT_MODEL
      const envLevel = process.env.CAGENT_LEVEL
      const envEffort = process.env.CAGENT_EFFORT

      const config = loadConfig()
      const agentId = options.agent ?? process.env.CAGENT_AGENT ?? config.default_agent
      const agent = getAgent(config, agentId)
      const adapter = getAgentAdapter(agentId)
      const resolved = resolveModel(config, {
        agent: agentId,
        cliModel,
        cliLevel,
        envModel,
        envLevel,
        cliEffort,
        envEffort,
      })

      for (const warning of resolved.warnings) {
        console.warn(`Warning: ${warning}`)
      }

      const extraArgs = program.args.slice(positionalLevel !== undefined ? 1 : 0)
      const ctx = {
        bin: agent.bin,
        modelId: resolved.modelId,
        level: resolved.levelName ?? config.default_level,
        cwd: process.cwd(),
        extraArgs,
        config: agent,
        effort: resolved.effort,
      }
      const spec = adapter.buildStartCommand?.(ctx) ?? adapter.buildRunCommand(ctx)

      if (options.dryRun) {
        console.log(`# Resolved level: ${resolved.levelName ?? config.default_level}`)
        if (resolved.effort) {
          console.log(`# Resolved effort: ${resolved.effort}`)
        }
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
