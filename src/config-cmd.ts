import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Command } from 'commander'
import { ConfigError, configPath, loadConfig } from './config.js'

function resolveConfigPath(): string {
  return process.env.CAGENT_CONFIG ?? configPath()
}

export const DEFAULT_CONFIG = `default_agent: codex
default_level: mid
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      low:
        description: Fast and affordable tasks
        default_model: gpt-5.6-luna
        models: [gpt-5.6-luna]
      mid:
        description: Balanced everyday tasks
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
      high:
        description: Frontier agentic coding tasks
        default_model: gpt-5.6-sol
        models: [gpt-5.6-sol]
  opencode-go:
    bin: opencode
    provider: opencode-go
    model_id_prefix: true
    levels:
      low:
        description: Fast and affordable tasks
        default_model: deepseek-v4-flash
        models: [deepseek-v4-flash]
      mid:
        description: Balanced everyday tasks
        default_model: deepseek-v4-pro
        models: [deepseek-v4-pro]
      high:
        description: Frontier agentic coding tasks
        default_model: kimi-k2.7-code
        models: [kimi-k2.7-code]

multiplexer:
  default: herdr

  herdr:
    enabled: true
    start_command_template: "cagent {level}"
    run_command_template: "cagent run {level} -- {prompt}"

  tmux:
    enabled: false
    note: "tmux is not the primary target. Kept only as a possible future adapter."
`

function getEditor(): string | undefined {
  return process.env.EDITOR || process.env.VISUAL
}

function findFallbackEditor(): string | undefined {
  for (const candidate of ['nano', 'vim', 'vi']) {
    try {
      const result = spawnSync('sh', ['-c', `command -v ${candidate}`], {
        shell: false,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
      if (result.status === 0 && result.stdout.trim().length > 0) {
        return candidate
      }
    } catch {
      // fall through
    }
  }
  return undefined
}

export function createConfigCommand(): Command {
  const command = new Command('config')

  command.description('Manage cagent configuration')

  command
    .command('path')
    .description('Show the current config file path')
    .action(() => {
      console.log(configPath())
    })

  const init = command
    .command('init')
    .description('Create the default config file if it does not exist')
    .option('-f, --force', 'overwrite an existing config file')
    .option('-d, --dry-run', 'print the default config without writing it')
    .action((options: { force?: boolean; dryRun?: boolean }) => {
      const path = resolveConfigPath()

      const globals = init.optsWithGlobals() as { dryRun?: boolean }
      if (options.dryRun || globals.dryRun) {
        console.log(DEFAULT_CONFIG)
        return
      }

      if (existsSync(path) && !options.force) {
        console.error(`Error: config file already exists: ${path}\n\nUse --force to overwrite.`)
        process.exit(1)
      }

      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, DEFAULT_CONFIG, 'utf-8')
        console.log(`Created config file: ${path}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Error: failed to create config file: ${message}`)
        process.exit(1)
      }
    })

  command
    .command('edit')
    .description('Open the config file in an editor')
    .action(() => {
      const path = resolveConfigPath()

      try {
        loadConfig(path)
      } catch (err) {
        const message = err instanceof ConfigError ? err.message : String(err)
        console.error(`Error: ${message}`)
        process.exit(1)
      }

      const editor = getEditor() ?? findFallbackEditor()
      if (!editor) {
        console.error('Error: no editor found. Set EDITOR or VISUAL environment variable.')
        process.exit(1)
      }

      const result = spawnSync(editor, [path], {
        stdio: 'inherit',
        shell: false,
      })

      if (result.status !== 0) {
        process.exit(result.status ?? 1)
      }
    })

  return command
}
