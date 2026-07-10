import { spawnSync } from 'node:child_process'
import { runCommandFormat } from '../command.js'
import type { Config } from '../config.js'

export interface HerdrContext {
  config: Config
  modelId: string
  level: string
  cwd: string
  extraArgs: string[]
  dryRun: boolean
}

export class HerdrAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HerdrAdapterError'
  }
}

function checkHerdrBin(): void {
  const result = spawnSync('sh', ['-c', 'command -v herdr'], {
    shell: false,
    stdio: 'pipe',
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new HerdrAdapterError('herdr CLI not found in PATH')
  }
}

function runHerdr(args: string[]): {
  stdout: string
  stderr: string
  status: number | null
} {
  return spawnSync('herdr', args, {
    shell: false,
    stdio: 'pipe',
    encoding: 'utf-8',
  })
}

function parsePaneId(stdout: string): string {
  const text = stdout.trim()
  if (!text) {
    throw new HerdrAdapterError('herdr returned empty output')
  }

  try {
    const parsed = JSON.parse(text)
    const pane = parsed?.result?.pane
    if (pane && typeof pane.pane_id === 'string') {
      return pane.pane_id
    }
  } catch {
    const first = text.split('\n')[0].trim()
    if (first) {
      return first
    }
  }

  throw new HerdrAdapterError(`could not parse pane id from herdr output: ${text}`)
}

function getCurrentPane(): string {
  const result = runHerdr(['pane', 'current', '--current'])
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane current failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }
  return parsePaneId(result.stdout)
}

function splitPane(currentPane: string, cwd: string): string {
  const result = runHerdr([
    'pane',
    'split',
    '--pane',
    currentPane,
    '--direction',
    'right',
    '--cwd',
    cwd,
  ])
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane split failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }
  return parsePaneId(result.stdout)
}

function buildOpenCodeCommand(
  config: Config,
  modelId: string,
  extraArgs: string[],
  mode: 'start' | 'run',
): string {
  const args =
    mode === 'run' ? ['run', '--model', modelId, ...extraArgs] : ['--model', modelId, ...extraArgs]
  return runCommandFormat(config.opencode_bin, args)
}

function quoteForHerdr(command: string): string {
  return `'${command.replace(/'/g, `'\\''`)}'`
}

function printDryRunSequence(cwd: string, opencodeCommand: string): void {
  console.log('# Herdr dry-run command sequence:')
  console.log('herdr pane current --current')
  console.log(`herdr pane split --pane <current-pane> --direction right --cwd ${cwd}`)
  console.log(`herdr pane run <new-pane> ${quoteForHerdr(opencodeCommand)}`)
}

function runInPane(pane: string, command: string): void {
  const result = runHerdr(['pane', 'run', pane, command])
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane run failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }
}

function executeHerdrMux(ctx: HerdrContext, mode: 'start' | 'run'): void {
  const opencodeCommand = buildOpenCodeCommand(ctx.config, ctx.modelId, ctx.extraArgs, mode)

  if (ctx.dryRun) {
    printDryRunSequence(ctx.cwd, opencodeCommand)
    return
  }

  checkHerdrBin()
  const currentPane = getCurrentPane()
  const newPane = splitPane(currentPane, ctx.cwd)
  runInPane(newPane, opencodeCommand)
}

export function executeHerdrStart(ctx: HerdrContext): void {
  executeHerdrMux(ctx, 'start')
}

export function executeHerdrRun(ctx: HerdrContext): void {
  executeHerdrMux(ctx, 'run')
}
