import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import YAML from 'yaml'

type AgentLevelEntry = { expected_model: string }
type AgentMatrix = Record<string, AgentLevelEntry>
type Matrix = Record<string, AgentMatrix>

export type CommandOutput = { status: number; stdout: string; stderr: string }
type Status = 'pass' | 'fail'

type LevelResult = {
  agent: string
  level: string
  expectedModel: string
  dryRun: CommandOutput
  routingStatus: Status
  live?: { status: Status; exitCode: number; diagnostic?: string }
}

export type ManualAttestation = {
  method: 'herdr-pane'
  verified_by: string
  verified_at: string
  expected_model: string
  observed_cli_model: string
  status: 'pass'
}

export type ManualAttestationResult = {
  status: Status | 'not_provided'
  attestation?: ManualAttestation
  diagnostic?: string
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
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
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
  if (agentName === 'codex') return output.includes(`codex exec --model ${expectedModel}`)
  if (agentName === 'opencode-go') return output.includes(`opencode run --model ${expectedModel}`)
  return false
}

export function validateManualAttestation(
  path: string | undefined,
  expectedModel: string,
): ManualAttestationResult {
  if (!path) return { status: 'not_provided', diagnostic: 'manual attestation was not provided' }
  try {
    const value = YAML.parse(readFileSync(path, 'utf8')) as { manual_attestation?: unknown }
    const attestation = value?.manual_attestation
    if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
      return { status: 'fail', diagnostic: 'manual_attestation mapping is required' }
    }
    const entry = attestation as Record<string, unknown>
    const requiredStrings = [
      'method',
      'verified_by',
      'verified_at',
      'expected_model',
      'observed_cli_model',
      'status',
    ]
    if (requiredStrings.some((key) => typeof entry[key] !== 'string' || entry[key].trim() === '')) {
      return { status: 'fail', diagnostic: 'manual_attestation has missing required string fields' }
    }
    if (entry.method !== 'herdr-pane')
      return { status: 'fail', diagnostic: 'method must be herdr-pane' }
    if (entry.status !== 'pass') return { status: 'fail', diagnostic: 'status must be pass' }
    if (Number.isNaN(Date.parse(entry.verified_at as string))) {
      return { status: 'fail', diagnostic: 'verified_at must be an ISO-8601 timestamp' }
    }
    if (entry.expected_model !== expectedModel || entry.observed_cli_model !== expectedModel) {
      return {
        status: 'fail',
        diagnostic: `expected and observed models must equal ${expectedModel}`,
      }
    }
    return { status: 'pass', attestation: entry as unknown as ManualAttestation }
  } catch (error) {
    return { status: 'fail', diagnostic: `could not read manual attestation: ${String(error)}` }
  }
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
): { status: Status; exitCode: number; diagnostic?: string } {
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
  const result = run(bin, ['--version'])
  return result.status === 0 ? result.stdout.trim() : 'not installed'
}

function writeReport(
  reportDir: string,
  manifest: Record<string, unknown>,
  scores: Record<string, unknown>,
  lines: string[],
): void {
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(join(reportDir, 'manifest.yaml'), YAML.stringify(manifest))
  writeFileSync(join(reportDir, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`)
  writeFileSync(join(reportDir, 'report.md'), `${lines.join('\n')}\n`)
}

function reportBase(profile: string, live: boolean): Record<string, unknown> {
  return {
    run_id: runId(),
    tested_commit: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    config_sha256: configHash(),
    codex_cli: getCliVersion('codex'),
    opencode_cli: getCliVersion('opencode'),
    profile,
    mode: live ? 'live' : 'routing-only',
    backend_attestation: 'unobservable',
  }
}

function buildAndCheckCli(): {
  status: Status
  help: Status
  version: Status
  diagnostic?: string
} {
  const build = run('bun', ['run', 'build'])
  if (build.status !== 0 || !existsSync(builtEntryPoint))
    return {
      status: 'fail',
      help: 'fail',
      version: 'fail',
      diagnostic: build.stderr || 'Build did not create dist/index.js',
    }
  const help = run('node', [builtEntryPoint, '--help'])
  const version = run('node', [builtEntryPoint, '--version'])
  const helpStatus: Status = help.status === 0 && /Usage:/i.test(help.stdout) ? 'pass' : 'fail'
  const versionStatus: Status = version.status === 0 ? 'pass' : 'fail'
  return {
    status: helpStatus === 'pass' && versionStatus === 'pass' ? 'pass' : 'fail',
    help: helpStatus,
    version: versionStatus,
  }
}

function smokeCore(args: string[], reportDir: string): number {
  const requestedAgent = option(args, '--agent')
  const live = args.includes('--live')
  const cli = buildAndCheckCli()
  if (cli.status === 'fail') return 1
  const matrix = loadMatrix()
  const agentNames = requestedAgent ? [requestedAgent] : Object.keys(matrix)
  if (agentNames.some((name) => !matrix[name])) {
    console.error(`Unknown agent: ${requestedAgent}`)
    return 1
  }
  const prompt = readFileSync(promptPath, 'utf8').trim()
  const results: LevelResult[] = []
  for (const agentName of agentNames)
    for (const [level, value] of Object.entries(matrix[agentName])) {
      const dryRun = run('node', cagentArgs(agentName, level, prompt, false), root, {
        ...process.env,
        CAGENT_CONFIG: configPath,
      })
      const result: LevelResult = {
        agent: agentName,
        level,
        expectedModel: value.expected_model,
        dryRun,
        routingStatus:
          dryRun.status === 0 && assertDryRunModel(dryRun.stdout, value.expected_model, agentName)
            ? 'pass'
            : 'fail',
      }
      if (live) result.live = runLive(agentName, level, prompt)
      results.push(result)
    }
  const passed =
    cli.status === 'pass' &&
    results.every((result) => result.routingStatus === 'pass' && result.live?.status !== 'fail')
  const baseManifest = reportBase('core', live)
  const manifest = {
    ...baseManifest,
    cli_help: cli.help,
    cli_version: cli.version,
  }
  writeReport(reportDir, manifest, { routing: results }, [
    '# Model routing smoke report',
    '',
    `- Status: **${passed ? 'pass' : 'fail'}**`,
    `- Mode: ${baseManifest.mode}`,
    `- Tested commit: ${baseManifest.tested_commit}`,
    `- Codex CLI: ${baseManifest.codex_cli}`,
    `- OpenCode CLI: ${baseManifest.opencode_cli}`,
    '- Profile: core',
    `- Backend attestation: ${baseManifest.backend_attestation}`,
    `- CLI --help: ${cli.help}`,
    `- CLI --version: ${cli.version}`,
    '',
    '| Agent | Level | Expected model | Routing | Live run |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.agent} | ${r.level} | ${r.expectedModel} | ${r.routingStatus} | ${r.live?.status ?? 'not run'} |`,
    ),
    '',
    'Automatic routing is verified at the cagent-to-CLI boundary. Provider-reported model IDs are not collected by this runner.',
  ])
  return passed ? 0 : 1
}

function smokeExtended(args: string[], reportDir: string): number {
  const agent = option(args, '--agent') ?? 'codex'
  const level = option(args, '--level') ?? 'mid'
  const expectedModel = loadMatrix()[agent]?.[level]?.expected_model
  if (!expectedModel) {
    console.error(`Unknown agent or level: ${agent}:${level}`)
    return 1
  }
  const cli = buildAndCheckCli()
  const prompt = readFileSync(promptPath, 'utf8').trim()
  const env = { ...process.env, CAGENT_CONFIG: configPath }
  const doctor =
    cli.status === 'pass'
      ? run('node', [builtEntryPoint, 'doctor'], root, env)
      : { status: 1, stdout: '', stderr: cli.diagnostic ?? 'build failed' }
  const models =
    cli.status === 'pass' ? run('node', [builtEntryPoint, 'models'], root, env) : doctor
  const muxDryRun =
    cli.status === 'pass'
      ? run(
          'node',
          [builtEntryPoint, '--dry-run', 'mux', 'run', '--agent', agent, level, '--', prompt],
          root,
          env,
        )
      : doctor
  const muxLaunch =
    cli.status === 'pass'
      ? run(
          'node',
          [builtEntryPoint, 'mux', 'run', '--agent', agent, level, '--', prompt],
          root,
          env,
        )
      : doctor
  const routing: Status =
    muxDryRun.status === 0 && assertDryRunModel(muxDryRun.stdout, expectedModel, agent)
      ? 'pass'
      : 'fail'
  const attestation = validateManualAttestation(option(args, '--attestation'), expectedModel)
  const checks = {
    cli,
    doctor: doctor.status === 0 ? 'pass' : 'fail',
    models: models.status === 0 ? 'pass' : 'fail',
    mux_routing: routing,
    herdr_launch: muxLaunch.status === 0 ? 'pass' : 'fail',
  }
  const passed =
    Object.values(checks).every(
      (value) => value === 'pass' || (typeof value === 'object' && value.status === 'pass'),
    ) && attestation.status === 'pass'
  const manifest = { ...reportBase('extended', false), expected_model: expectedModel }
  writeReport(
    reportDir,
    manifest,
    {
      automatic_routing: { agent, level, expected_model: expectedModel, status: routing },
      environment_checks: checks,
      manual_attestation: attestation,
      backend_attestation: 'unobservable',
    },
    [
      '# Herdr extended smoke report',
      '',
      `- Status: **${passed ? 'pass' : 'fail'}**`,
      '- Profile: extended',
      `- Expected model: ${expectedModel}`,
      `- Automatic routing: ${routing}`,
      `- Doctor: ${checks.doctor}`,
      `- Models: ${checks.models}`,
      `- Herdr launch: ${checks.herdr_launch}`,
      `- Manual attestation: ${attestation.status}`,
      '- Backend attestation: unobservable',
      ...(attestation.diagnostic
        ? [`- Manual attestation diagnostic: ${attestation.diagnostic}`]
        : []),
      '',
      'Automatic routing, human Herdr-pane attestation, and provider-side backend attestation are separate evidence sources.',
    ],
  )
  return passed ? 0 : 1
}

function smoke(args: string[]): number {
  const profile = option(args, '--profile') ?? 'core'
  const reportDir = option(args, '--report-dir') ?? join(validationRoot, '.artifacts', runId())
  const exitCode =
    profile === 'core'
      ? smokeCore(args, reportDir)
      : profile === 'extended'
        ? smokeExtended(args, reportDir)
        : 1
  if (profile !== 'core' && profile !== 'extended') console.error(`Unsupported profile: ${profile}`)
  console.log(`Validation report: ${reportDir}`)
  return exitCode
}

function main(): number {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'smoke') return smoke(args)
  console.error(
    'Usage: bun run validate smoke --profile <core|extended> [--agent <id>] [--level <level>] [--attestation <path>] [--live] [--report-dir <path>]',
  )
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.path))
  process.exitCode = main()
