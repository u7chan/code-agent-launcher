import { Command, Option } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { configPath, getAgent, loadConfig } from './config.js'
import { isJsonMode, outputJsonSuccess } from './json-output.js'
import { resolveModel } from './model.js'
import { assertTty } from './tty.js'
import { VERSION } from './version.js'

export interface MainOptions {
  level?: string
  model?: string
  effort?: string
  dryRun?: boolean
  json?: boolean
  adapter?: string
  agent?: string
}

export function createMainCommand(): Command {
  const program = new Command()

  program
    .name('cagent')
    .description('Coding-agent launcher with model routing')
    .version(VERSION)
    .addOption(new Option('-v', 'output the version number').hideHelp())
    .argument('[level]', 'task level (low, mid, high, etc.)')
    .option('-l, --level <level>', 'task level')
    .option('-m, --model <model>', 'explicit model id')
    .option('-e, --effort <effort>', 'explicit reasoning effort')
    .option('-a, --agent <agent>', 'coding agent id')
    .option('-d, --dry-run', 'print the resolved command without executing')
    .option('--json', 'output control information as JSON')
    .addOption(
      new Option('--adapter <adapter>', 'multiplexer adapter to use').default(undefined).hideHelp(),
    )
    .allowUnknownOption()
    .action(async (positionalLevel: string | undefined, options: MainOptions) => {
      if (positionalLevel?.startsWith('--')) {
        program.error(`error: unknown option '${positionalLevel}'`)
      }

      if (program.opts().v) {
        console.log(VERSION)
        process.exit(0)
      }

      const json = isJsonMode(options)
      if (json && !options.dryRun) {
        console.error(
          'cagent: --json requires --dry-run for [level] command\n' +
            'Use `cagent run --dry-run [level] --json` for cagent control metadata.\n' +
            'Pass `--json` after `--` when requesting JSON from the underlying agent CLI.',
        )
        process.exit(1)
      }

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

      if (!options.dryRun) {
        assertTty('[level]', ['cagent run <level> -- "<prompt>"', 'cagent mux start <level>'])
      }

      const spec = adapter.buildStartCommand?.(ctx) ?? adapter.buildRunCommand(ctx)

      if (options.dryRun) {
        const level = resolved.levelName ?? config.default_level
        if (json) {
          outputJsonSuccess('run.plan', {
            interactive: true,
            config_path: configPath(),
            agent: agentId,
            level,
            model: resolved.modelId,
            effort: resolved.effort,
            command: {
              executable: spec.command,
              args: spec.args,
              env: spec.env ?? {},
            },
          })
          return
        }
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
