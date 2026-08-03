import { Command } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { getAgent, loadConfig, resolveConfigPath } from './config.js'
import {
  isJsonMode,
  type JsonWarning,
  outputJsonFailure,
  outputJsonSuccess,
} from './json-output.js'
import { resolveModel } from './model.js'

export interface RunCommandOptions {
  agent?: string
  level?: string
  model?: string
  effort?: string
  dryRun?: boolean
  json?: boolean
}

/**
 * Parse `cagent run` argv so that:
 * - optional level is taken only from tokens before `--`
 * - tokens after `--` are always prompt/extra args (never level)
 */
export function parseRunArgv(argv: string[]): {
  positionalLevel?: string
  extraArgs: string[]
} {
  let start = -1
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === 'run') {
      start = i + 1
    }
  }
  if (start === -1) {
    return { extraArgs: [] }
  }

  const rest = argv.slice(start)
  const dd = rest.indexOf('--')
  const beforeDd = dd === -1 ? rest : rest.slice(0, dd)
  const afterDd = dd === -1 ? [] : rest.slice(dd + 1)

  const positionals: string[] = []
  for (let i = 0; i < beforeDd.length; i++) {
    const arg = beforeDd[i]
    if (arg.startsWith('-')) {
      if (
        arg === '--dry-run' ||
        arg === '-d' ||
        arg === '--json' ||
        arg === '--help' ||
        arg === '-h' ||
        arg === '--version' ||
        arg === '-V'
      ) {
        continue
      }
      if (arg.includes('=')) {
        continue
      }
      i += 1
      continue
    }
    positionals.push(arg)
  }

  return {
    positionalLevel: positionals[0],
    extraArgs: [...positionals.slice(1), ...afterDd],
  }
}

function parseRunCommandArgs(args: string[]): {
  positionalLevel?: string
  extraArgs: string[]
} {
  if (args[0] && !args[0].startsWith('-')) {
    return {
      positionalLevel: args[0],
      extraArgs: args.slice(1),
    }
  }
  return { extraArgs: args }
}

export function createRunCommand(): Command {
  const command = new Command('run')

  command
    .description('Run a coding agent non-interactively with a prompt')
    .option('-a, --agent <agent>', 'coding agent id')
    .allowUnknownOption()
    .action(async () => {
      const globals = command.optsWithGlobals() as RunCommandOptions
      const { positionalLevel, extraArgs } = process.argv.includes('run')
        ? parseRunArgv(process.argv)
        : parseRunCommandArgs(command.args)

      const cliLevel = globals.level ?? positionalLevel
      const cliModel = globals.model
      const cliEffort = globals.effort
      const envModel = process.env.CAGENT_MODEL
      const envLevel = process.env.CAGENT_LEVEL
      const envEffort = process.env.CAGENT_EFFORT
      const dryRun = globals.dryRun === true
      const json = isJsonMode(globals)

      if (json && !dryRun) {
        outputJsonFailure(
          'run.plan',
          'USAGE_ERROR',
          '--json requires --dry-run for this command',
          { suggestion: 'Use --dry-run --json or pass --json after --' },
          'Use `cagent run --dry-run [level] --json` for cagent control metadata.\n' +
            'Pass `--json` after `--` when requesting JSON from the underlying agent CLI.',
        )
        process.exit(1)
      }

      const config = loadConfig()
      const effectiveAgentId = globals.agent ?? process.env.CAGENT_AGENT ?? config.default_agent
      const agent = getAgent(config, effectiveAgentId)
      const adapter = getAgentAdapter(effectiveAgentId)
      const resolved = resolveModel(config, {
        agent: effectiveAgentId,
        cliModel,
        cliLevel,
        envModel,
        envLevel,
        cliEffort,
        envEffort,
      })

      const warnings: JsonWarning[] = []
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

      const spec = adapter.buildRunCommand({
        bin: agent.bin,
        modelId: resolved.modelId,
        level: resolved.levelName ?? config.default_level,
        cwd: process.cwd(),
        extraArgs,
        config: agent,
        effort: resolved.effort,
      })

      if (dryRun) {
        const displayLevel =
          resolved.levelName && agent.levels[resolved.levelName]
            ? resolved.levelName
            : config.default_level
        if (json) {
          outputJsonSuccess(
            'run.plan',
            {
              interactive: false,
              config_path: resolveConfigPath(),
              agent: effectiveAgentId,
              level: displayLevel,
              model: resolved.modelId,
              effort: resolved.effort,
              command: {
                executable: spec.command,
                args: spec.args,
                env: spec.env ?? {},
              },
            },
            warnings,
          )
          return
        }
        console.log(`# Resolved level: ${displayLevel}`)
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

  return command
}
