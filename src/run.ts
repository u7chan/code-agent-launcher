import { Command } from 'commander'
import { runCommand, runCommandFormat } from './command.js'
import { loadConfig } from './config.js'
import { resolveModel } from './model.js'

export interface RunCommandOptions {
  level?: string
  model?: string
  dryRun?: boolean
}

/**
 * Parse `ocgo run` argv so that:
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

export function createRunCommand(): Command {
  const command = new Command('run')

  command
    .description('Run opencode non-interactively with a prompt')
    .allowUnknownOption()
    .action(async () => {
      const globals = command.optsWithGlobals() as RunCommandOptions
      const { positionalLevel, extraArgs } = parseRunArgv(process.argv)

      const cliLevel = globals.level ?? positionalLevel
      const cliModel = globals.model
      const envModel = process.env.OCGO_MODEL
      const envLevel = process.env.OCGO_LEVEL
      const dryRun = globals.dryRun === true

      const config = loadConfig()
      const resolved = resolveModel(config, {
        cliModel,
        cliLevel,
        envModel,
        envLevel,
      })

      for (const warning of resolved.warnings) {
        console.warn(`Warning: ${warning}`)
      }

      const args = ['run', '--model', resolved.modelId, ...extraArgs]

      if (dryRun) {
        const displayLevel =
          resolved.levelName && config.levels[resolved.levelName]
            ? resolved.levelName
            : config.default_level
        console.log(`# Resolved level: ${displayLevel}`)
        console.log(runCommandFormat(config.opencode_bin, args))
        return
      }

      const result = await runCommand(config.opencode_bin, args, {
        stdio: 'inherit',
      })

      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode)
      }
    })

  return command
}
