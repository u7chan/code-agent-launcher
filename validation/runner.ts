import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import YAML from 'yaml'

type AgentLevelEntry = {
  expected_model: string
}

type AgentMatrix = Record<string, AgentLevelEntry>

type Matrix = Record<string, AgentMatrix>

type CommandOutput = {
  status: number
  stdout: string
  stderr: string
}

type LevelResult = {
  agent: string
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

export function assertDryRunModel(
  output: string,
  expectedModel: string,
  agentName: string,
): boolean {
  if (agentName === 'codex') {
    return output.includes(`codex exec --model ${expectedModel}`)
  }
  if (agentName === 'opencode-go') {
    return output.includes(`opencode run --model ${expectedModel}`)
  }
  return false
}

function cagentArgs(agentName: string, level: string, prompt: string, live: boolean): string[] {
  const extras =
    agentName === 'codex'
      ? ['--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', prompt]
      : [prompt]
  return [
    builtEntryPoint,
    ...(live ? [] : ['--dry-run']),
    'run',
    '--agent',
    agentName,
    level,
    '--',
    ...extras,
  ]
}

function runLive(
  agentName: string,
  level: string,
  prompt: string,
): { status: 'pass' | 'fail'; exitCode: number; diagnostic?: string } {
  const workspace = mkdtempSync(join(tmpdir(), 'cagent-validation-'))
  try {
    const result = run('node', cagentArgs(agentName, level, prompt, true), workspace, {
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

function getCliVersion(bin: string): string {
  try {
    const result = run(bin, ['--version'])
    return result.status === 0 ? result.stdout.trim() : 'not installed'
  } catch {
    return 'not installed'
  }
}

function writeReport(
  results: LevelResult[],
  live: boolean,
  reportDir: string,
  cliHelp: 'pass' | 'fail',
  cliVersion: 'pass' | 'fail',
): void {
  mkdirSync(reportDir, { recursive: true })
  const testedCommit = run('git', ['rev-parse', 'HEAD']).stdout.trim()
  const manifest = {
    run_id: runId(),
    tested_commit: testedCommit,
    config_sha256: configHash(),
    codex_cli: getCliVersion('codex'),
    opencode_cli: getCliVersion('opencode'),
    mode: live ? 'live' : 'routing-only',
    backend_attestation: 'unobservable',
    cli_help: cliHelp,
    cli_version: cliVersion,
  }
  const scores = { routing: results }
  const routingPass = results.every(
    (result) => result.routingStatus === 'pass' && result.live?.status !== 'fail',
  )
  const cliPass = cliHelp === 'pass' && cliVersion === 'pass'
  const allPass = routingPass && cliPass ? 'pass' : 'fail'
  const lines = [
    '# Model routing smoke report',
    '',
    `- Status: **${allPass}**`,
    `- Mode: ${manifest.mode}`,
    `- Tested commit: ${manifest.tested_commit}`,
    `- Codex CLI: ${manifest.codex_cli}`,
    `- OpenCode CLI: ${manifest.opencode_cli}`,
    `- Backend attestation: ${manifest.backend_attestation}`,
    `- CLI --help: ${cliHelp}`,
    `- CLI --version: ${cliVersion}`,
    '',
    '| Agent | Level | Expected model | Routing | Live run |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.agent} | ${result.level} | ${result.expectedModel} | ${result.routingStatus} | ${result.live?.status ?? 'not run'} |`,
    ),
    '',
    'Model identity is verified at the cagent-to-CLI boundary. Provider-reported model IDs are not collected by this runner.',
    '',
  ]
  writeFileSync(join(reportDir, 'manifest.yaml'), YAML.stringify(manifest))
  writeFileSync(join(reportDir, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`)
  writeFileSync(join(reportDir, 'report.md'), lines.join('\n'))
}

function smoke(args: string[]): number {
  const profile = option(args, '--profile') ?? 'core'
  if (profile !== 'core') {
    console.error(`Unsupported profile: ${profile}`)
    return 1
  }
  const requestedAgent = option(args, '--agent')
  const live = args.includes('--live')
  const reportDir = option(args, '--report-dir') ?? join(validationRoot, '.artifacts', runId())

  console.log('Building cagent...')
  const build = run('bun', ['run', 'build'])
  if (build.status !== 0) {
    process.stderr.write(build.stderr)
    return build.status
  }
  if (!existsSync(builtEntryPoint)) {
    console.error('Build did not create dist/index.js')
    return 1
  }

  console.log('Verifying --help / --version...')
  const helpResult = run('node', [builtEntryPoint, '--help'])
  const versionResult = run('node', [builtEntryPoint, '--version'])
  const cliHelp = helpResult.status === 0 && /Usage:/i.test(helpResult.stdout) ? 'pass' : 'fail'
  const cliVersion = versionResult.status === 0 ? 'pass' : 'fail'
  if (cliHelp === 'fail') console.error('  --help verification failed')
  if (cliVersion === 'fail') console.error('  --version verification failed')

  const matrix = loadMatrix()
  const agentNames = requestedAgent ? [requestedAgent] : Object.keys(matrix)
  for (const name of agentNames) {
    if (!matrix[name]) {
      console.error(`Unknown agent: ${name}`)
      return 1
    }
  }

  const prompt = readFileSync(promptPath, 'utf8').trim()
  const results: LevelResult[] = []

  for (const agentName of agentNames) {
    const agentLevels = matrix[agentName]
    for (const [level, value] of Object.entries(agentLevels)) {
      console.log(`Testing ${agentName}:${level} (${value.expected_model})...`)
      const dryRun = run('node', cagentArgs(agentName, level, prompt, false), root, {
        ...process.env,
        CAGENT_CONFIG: configPath,
      })
      const routingStatus =
        dryRun.status === 0 && assertDryRunModel(dryRun.stdout, value.expected_model, agentName)
          ? 'pass'
          : 'fail'
      const result: LevelResult = {
        agent: agentName,
        level,
        expectedModel: value.expected_model,
        dryRun,
        routingStatus,
        backendAttestation: 'unobservable',
      }
      if (live) {
        result.live = runLive(agentName, level, prompt)
      }
      results.push(result)
    }
  }

  writeReport(results, live, reportDir, cliHelp, cliVersion)
  console.log(`\nValidation report: ${reportDir}`)
  const routingPass = results.every(
    (result) => result.routingStatus === 'pass' && result.live?.status !== 'fail',
  )
  const cliPass = cliHelp === 'pass' && cliVersion === 'pass'
  return routingPass && cliPass ? 0 : 1
}

function main(): number {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'smoke') return smoke(args)
  console.error(
    'Usage: bun run validate smoke --profile core [--agent <id>] [--live] [--report-dir <path>]',
  )
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.path)) {
  process.exitCode = main()
}
