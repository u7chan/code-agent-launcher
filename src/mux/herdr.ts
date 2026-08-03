import { spawnSync } from 'node:child_process'
import type { CommandSpec } from '../agents/types.js'
import { formatCommandSpecForShell } from '../command.js'
import {
  type MuxExecutionPlanResult,
  type MuxExecutionResult,
  type MuxMode,
  type MuxStep,
  type MuxStepRecord,
  toMuxCommandSpec,
} from './types.js'

export interface HerdrContext {
  command: CommandSpec
  cwd: string
  extraArgs: string[]
  dryRun: boolean
}

export class HerdrAdapterError extends Error {
  readonly exitCode: number | null | undefined

  constructor(message: string, exitCode?: number | null) {
    super(message)
    this.name = 'HerdrAdapterError'
    this.exitCode = exitCode
  }
}

export function checkHerdrBin(): void {
  const result = spawnSync('sh', ['-c', 'command -v herdr'], {
    shell: false,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env },
  })
  if (result.status !== 0) {
    const processError = result.error?.message
    throw new HerdrAdapterError(
      processError
        ? `herdr preflight process error: ${processError}`
        : 'herdr CLI not found in PATH',
      result.status ?? null,
    )
  }
}

export interface HerdrCommandResult {
  stdout: string
  stderr: string
  status: number | null
  error?: Error
}

export function runHerdr(args: string[]): HerdrCommandResult {
  const result = spawnSync('herdr', args, {
    shell: false,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error,
  }
}

export function parsePaneId(stdout: string): string {
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

export function getCurrentPane(): string {
  const result = runHerdr(['pane', 'current', '--current'])
  if (result.error) {
    throw new HerdrAdapterError(
      `herdr pane current process error: ${result.error.message}`,
      result.status ?? null,
    )
  }
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane current failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
      result.status,
    )
  }
  return parsePaneId(result.stdout)
}

export function splitPane(currentPane: string, cwd: string): string {
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
  if (result.error) {
    throw new HerdrAdapterError(
      `herdr pane split process error: ${result.error.message}`,
      result.status ?? null,
    )
  }
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane split failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
      result.status,
    )
  }
  return parsePaneId(result.stdout)
}

export function quoteForHerdr(command: string): string {
  return `'${command.replace(/'/g, `'\\''`)}'`
}

export function runInPane(pane: string, command: string): void {
  const result = runHerdr(['pane', 'run', pane, command])
  if (result.error) {
    throw new HerdrAdapterError(
      `herdr pane run process error: ${result.error.message}`,
      result.status ?? null,
    )
  }
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane run failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
      result.status,
    )
  }
}

export function closePane(pane: string): void {
  const result = runHerdr(['pane', 'close', pane])
  if (result.error) {
    throw new HerdrAdapterError(
      `herdr pane close process error: ${result.error.message}`,
      result.status ?? null,
    )
  }
  if (result.status !== 0) {
    throw new HerdrAdapterError(
      `herdr pane close failed (exit ${result.status ?? 'unknown'}): ${result.stderr.trim() || result.stdout.trim()}`,
      result.status,
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failedStepRecord(step: MuxStep, error: unknown, paneId?: string): MuxStepRecord {
  const record: MuxStepRecord = {
    step,
    status: 'fail',
    error: errorMessage(error),
  }
  if (paneId) {
    record.pane_id = paneId
  }
  if (error instanceof HerdrAdapterError && error.exitCode !== undefined) {
    record.exit_code = error.exitCode
  }
  return record
}

function skippedStepRecord(step: MuxStep, reason: string): MuxStepRecord {
  return { step, status: 'skip', error: reason }
}

function createResult(mode: MuxMode, cwd: string): MuxExecutionResult {
  return {
    adapter: 'herdr',
    mode,
    cwd,
    command_dispatched: false,
    task_completed: false,
    steps: [],
  }
}

function createDryRunResult(ctx: HerdrContext, mode: MuxMode): MuxExecutionPlanResult {
  const command = toMuxCommandSpec(ctx.command)
  const currentPane: { value: '<current-pane>'; placeholder: true } = {
    value: '<current-pane>',
    placeholder: true,
  }
  const createdPane: { value: '<created-pane>'; placeholder: true } = {
    value: '<created-pane>',
    placeholder: true,
  }
  const paneOperations = [
    {
      step: 1,
      action: 'get_current_pane' as const,
      pane_id: currentPane,
    },
    {
      step: 2,
      action: 'split_pane' as const,
      pane_id: currentPane,
      created_pane_id: createdPane,
      direction: 'right' as const,
      cwd: ctx.cwd,
    },
    {
      step: 3,
      action: 'run_in_pane' as const,
      pane_id: createdPane,
      command,
      display_command: formatCommandSpecForShell(ctx.command),
    },
  ]
  const plan = {
    command,
    side_effects: ['pane.current', 'pane.split', 'pane.run'] as const,
    placeholders: {
      current_pane_id: currentPane,
      created_pane_id: createdPane,
    },
    pane_operations: paneOperations,
  }

  return {
    ...createResult(mode, ctx.cwd),
    command,
    plan,
    pane_operations: paneOperations,
    steps: [
      skippedStepRecord('preflight', 'dry-run: Herdr was not invoked'),
      skippedStepRecord('current', 'dry-run: current pane would be queried'),
      skippedStepRecord('split', 'dry-run: a pane would be created'),
      skippedStepRecord('dispatch', 'dry-run: the agent command would be dispatched'),
    ],
  }
}

function executeHerdrMux(
  ctx: HerdrContext,
  mode: MuxMode,
): MuxExecutionResult | MuxExecutionPlanResult {
  if (ctx.dryRun) {
    return createDryRunResult(ctx, mode)
  }

  const result = createResult(mode, ctx.cwd)

  try {
    checkHerdrBin()
    result.steps.push({ step: 'preflight', status: 'pass', exit_code: 0 })
  } catch (error) {
    result.steps.push(failedStepRecord('preflight', error))
    result.failed_step = 'preflight'
    result.steps.push(skippedStepRecord('current', 'not attempted because preflight failed'))
    result.steps.push(skippedStepRecord('split', 'not attempted because preflight failed'))
    result.steps.push(skippedStepRecord('dispatch', 'not attempted because preflight failed'))
    return result
  }

  let currentPane: string
  try {
    currentPane = getCurrentPane()
    result.current_pane_id = currentPane
    result.steps.push({ step: 'current', status: 'pass', pane_id: currentPane, exit_code: 0 })
  } catch (error) {
    result.steps.push(failedStepRecord('current', error))
    result.failed_step = 'current'
    result.steps.push(
      skippedStepRecord('split', 'not attempted because current pane lookup failed'),
    )
    result.steps.push(
      skippedStepRecord('dispatch', 'not attempted because current pane lookup failed'),
    )
    return result
  }

  let createdPane: string
  try {
    createdPane = splitPane(currentPane, ctx.cwd)
    result.created_pane_id = createdPane
    result.steps.push({ step: 'split', status: 'pass', pane_id: createdPane, exit_code: 0 })
  } catch (error) {
    result.steps.push(failedStepRecord('split', error))
    result.failed_step = 'split'
    result.steps.push(skippedStepRecord('dispatch', 'not attempted because pane split failed'))
    return result
  }

  try {
    runInPane(createdPane, formatCommandSpecForShell(ctx.command))
    result.command_dispatched = true
    result.steps.push({ step: 'dispatch', status: 'pass', pane_id: createdPane, exit_code: 0 })
  } catch (error) {
    result.steps.push(failedStepRecord('dispatch', error, createdPane))
    result.failed_step = 'dispatch'
  }

  return result
}

export function executeHerdrStart(ctx: HerdrContext): MuxExecutionResult | MuxExecutionPlanResult {
  return executeHerdrMux(ctx, 'start')
}

export function executeHerdrRun(ctx: HerdrContext): MuxExecutionResult | MuxExecutionPlanResult {
  return executeHerdrMux(ctx, 'run')
}
