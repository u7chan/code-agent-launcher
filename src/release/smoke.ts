import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const decoder = new TextDecoder()

export interface StandaloneSmokeOptions {
  binaryPath: string
  version: string
}

function cleanEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('CAGENT_') && typeof value === 'string') {
      environment[name] = value
    }
  }
  return environment
}

function runSmokeCommand(
  binaryPath: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Record<string, string>,
): string {
  const result = Bun.spawnSync({
    cmd: [binaryPath, ...arguments_],
    cwd,
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = decoder.decode(result.stdout)
  const stderr = decoder.decode(result.stderr)
  if (result.exitCode !== 0) {
    throw new Error(
      `Standalone smoke command failed (${arguments_.join(' ')}):\n${stdout}${stderr}`,
    )
  }
  return stdout
}

export async function runStandaloneSmoke(options: StandaloneSmokeOptions): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cagent-release-smoke-'))
  try {
    const executionDirectory = join(root, 'cwd')
    const configPath = join(root, 'config', 'config.yaml')
    const poisonedConfigPath = join(root, 'poisoned', 'config.yaml')
    const preloadMarkerPath = join(root, 'preload-ran')
    await mkdir(executionDirectory)
    await writeFile(
      join(executionDirectory, '.env'),
      [`CAGENT_CONFIG=${poisonedConfigPath}`, 'CAGENT_AGENT=must-not-be-loaded', ''].join('\n'),
    )
    await writeFile(join(executionDirectory, 'bunfig.toml'), 'preload = ["./must-not-run.ts"]\n')
    await writeFile(
      join(executionDirectory, 'must-not-run.ts'),
      `await Bun.write(${JSON.stringify(preloadMarkerPath)}, "preload ran")\nprocess.exit(91)\n`,
    )

    const environment = cleanEnvironment()
    environment.CAGENT_CONFIG = configPath

    const versionOutput = runSmokeCommand(
      options.binaryPath,
      ['--version'],
      executionDirectory,
      environment,
    )
    if (versionOutput.trim() !== options.version) {
      throw new Error(
        `Standalone version mismatch: expected ${options.version}, got ${versionOutput.trim()}`,
      )
    }

    const helpOutput = runSmokeCommand(
      options.binaryPath,
      ['--help'],
      executionDirectory,
      environment,
    )
    if (!helpOutput.includes('Usage: cagent')) {
      throw new Error('Standalone help output did not contain the expected usage line')
    }

    runSmokeCommand(options.binaryPath, ['config', 'init'], executionDirectory, environment)
    await access(configPath)

    const dryRunOutput = runSmokeCommand(
      options.binaryPath,
      ['--dry-run'],
      executionDirectory,
      environment,
    )
    if (!dryRunOutput.includes('# Resolved level: mid')) {
      throw new Error('Standalone did not use the explicitly initialized configuration')
    }

    if (await Bun.file(poisonedConfigPath).exists()) {
      throw new Error('Standalone loaded CAGENT_CONFIG from the execution directory .env')
    }
    if (await Bun.file(preloadMarkerPath).exists()) {
      throw new Error('Standalone executed a preload from the execution directory bunfig.toml')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
