import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import YAML from 'yaml'

type Matrix = {
  codex: Record<string, { expected_model: string }>
}

type CommandOutput = {
  status: number
  stdout: string
  stderr: string
}

type LevelResult = {
  level: string
  expectedModel: string
  dryRun: CommandOutput
  routingStatus: 'pass' | 'fail'
  live?: { status: 'pass' | 'fail'; exitCode: number; diagnostic?: string }
  backendAttestation: 'unobservable'
}

const root = resolve(import.meta.dir, '..')
const validationRoot = join(root, 'validation')
const builtEntryPoint = join(root, 'dist', 'index.js')
const configPath = join(validationRoot, 'config', 'cagent.yaml')
const matrixPath = join(validationRoot, 'config', 'matrix.yaml')
const promptPath = join(validationRoot, 'smoke', 'cases', 'model-routing', 'prompt.md')

export function loadMatrix(path = matrixPath): Matrix {
  return YAML.parse(readFileSync(path, 'utf8')) as Matrix
}

export function assertDryRunModel(output: string, expectedModel: string): boolean {
  return output.includes(`codex exec --model ${expectedModel}`)
}

function run(command: string, args: string[], cwd = root, env = process.env): CommandOutput {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function configHash(): string {
  return createHash('sha256').update(readFileSync(configPath)).digest('hex')
}

function cagentArgs(level: string, prompt: string, live: boolean, outputFile?: string): string[] {
  const extras = [
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    ...(outputFile ? ['--output-last-message', outputFile] : []),
    prompt,
  ]
  return [
    builtEntryPoint,
    ...(live ? [] : ['--dry-run']),
    'run',
    '--agent',
    'codex',
    level,
    '--',
    ...extras,
  ]
}

function runLive(
  level: string,
  prompt: string,
): { status: 'pass' | 'fail'; exitCode: number; diagnostic?: string } {
  const workspace = mkdtempSync(join(tmpdir(), 'cagent-validation-'))
  try {
    const outputFile = join(workspace, 'last-message.txt')
    const result = run('node', cagentArgs(level, prompt, true, outputFile), workspace, {
      ...process.env,
      CAGENT_CONFIG: configPath,
    })
    const diagnostic = [result.stderr, result.stdout]
      .join('\n')
      .split('\n')
      .filter((line) => /error|failed|not supported/i.test(line))
      .slice(0, 3)
      .join('\n')
    return {
      status: result.status === 0 ? 'pass' : 'fail',
      exitCode: result.status,
      ...(diagnostic ? { diagnostic } : {}),
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

function writeReport(results: LevelResult[], live: boolean, reportDir: string): void {
  mkdirSync(reportDir, { recursive: true })
  const manifest = {
    run_id: runId(),
    tested_commit: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    config_sha256: configHash(),
    codex_cli: run('codex', ['--version']).stdout.trim(),
    mode: live ? 'live' : 'routing-only',
    backend_attestation: 'unobservable',
  }
  const scores = { routing: results }
  const summary = results.every(
    (result) => result.routingStatus === 'pass' && result.live?.status !== 'fail',
  )
    ? 'pass'
    : 'fail'
  const lines = [
    '# Codex smoke report',
    '',
    `- Status: **${summary}**`,
    `- Mode: ${manifest.mode}`,
    `- Tested commit: ${manifest.tested_commit}`,
    `- Codex CLI: ${manifest.codex_cli}`,
    `- Backend attestation: ${manifest.backend_attestation}`,
    '',
    '| Level | Expected model | Routing | Live run |',
    '| --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.level} | ${result.expectedModel} | ${result.routingStatus} | ${result.live?.status ?? 'not run'} |`,
    ),
    '',
    'Model identity is verified at the cagent-to-Codex CLI boundary. Provider-reported model IDs are not collected by this runner.',
    '',
  ]
  writeFileSync(join(reportDir, 'manifest.yaml'), YAML.stringify(manifest))
  writeFileSync(join(reportDir, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`)
  writeFileSync(join(reportDir, 'report.md'), lines.join('\n'))
}

function smoke(args: string[]): number {
  const profile = option(args, '--profile') ?? 'core'
  if (profile !== 'core') {
    console.error(`Unsupported Codex-only profile: ${profile}`)
    return 1
  }
  const live = args.includes('--live')
  const reportDir = option(args, '--report-dir') ?? join(validationRoot, '.artifacts', runId())
  const build = run('bun', ['run', 'build'])
  if (build.status !== 0) {
    process.stderr.write(build.stderr)
    return build.status
  }
  if (!existsSync(builtEntryPoint)) {
    console.error('Build did not create dist/index.js')
    return 1
  }

  const matrix = loadMatrix()
  const prompt = readFileSync(promptPath, 'utf8').trim()
  const results = Object.entries(matrix.codex).map(([level, value]) => {
    const dryRun = run('node', cagentArgs(level, prompt, false), root, {
      ...process.env,
      CAGENT_CONFIG: configPath,
    })
    const routingStatus =
      dryRun.status === 0 && assertDryRunModel(dryRun.stdout, value.expected_model)
        ? 'pass'
        : 'fail'
    const result: LevelResult = {
      level,
      expectedModel: value.expected_model,
      dryRun,
      routingStatus,
      backendAttestation: 'unobservable',
    }
    if (live) {
      result.live = runLive(level, prompt)
    }
    return result
  })
  writeReport(results, live, reportDir)
  console.log(`Validation report: ${reportDir}`)
  return results.every(
    (result) => result.routingStatus === 'pass' && result.live?.status !== 'fail',
  )
    ? 0
    : 1
}

function main(): number {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'smoke') return smoke(args)
  console.error('Usage: bun run validate smoke --profile core [--live] [--report-dir <path>]')
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.path)) {
  process.exitCode = main()
}
