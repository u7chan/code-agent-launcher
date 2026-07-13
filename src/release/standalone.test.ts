import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStandalone } from './build.js'
import { releaseTargets } from './targets.js'

const decoder = new TextDecoder()

function createEnvironment(configHome: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (name !== 'CAGENT_CONFIG' && typeof value === 'string') {
      environment[name] = value
    }
  }
  environment.XDG_CONFIG_HOME = configHome
  return environment
}

function configYaml(): string {
  return [
    'version: 2',
    'default_agent: opencode-go',
    'default_level: low',
    'agents:',
    '  opencode-go:',
    '    bin: echo',
    '    provider: opencode-go',
    '    levels:',
    '      low:',
    '        description: Simple',
    '        default_model: test-model',
    '        models: [test-model]',
    'multiplexer:',
    '  default: herdr',
    '  herdr:',
    '    enabled: true',
    '',
  ].join('\n')
}

describe('standalone executable', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('embeds its version and ignores .env and bunfig.toml in the execution directory', async () => {
    if (process.platform !== 'linux' || process.arch !== 'x64') {
      return
    }

    const directory = await mkdtemp(join(tmpdir(), 'cagent-standalone-test-'))
    temporaryDirectories.push(directory)
    const binaryPath = join(directory, 'cagent')
    const isolatedDirectory = join(directory, 'isolated')
    const configHome = join(directory, 'config')

    await buildStandalone({
      entrypoint: join(import.meta.dir, '..', 'index.ts'),
      outfile: binaryPath,
      target: releaseTargets[0],
      version: '9.8.7',
    })

    expect((await stat(binaryPath)).mode & 0o111).not.toBe(0)

    await mkdir(join(configHome, 'cagent'), { recursive: true })
    await writeFile(join(configHome, 'cagent', 'config.yaml'), configYaml())
    await mkdir(isolatedDirectory)
    await writeFile(
      join(isolatedDirectory, '.env'),
      `CAGENT_CONFIG=${join(directory, 'poison.yaml')}\n`,
    )
    await writeFile(join(isolatedDirectory, 'bunfig.toml'), 'preload = ["./must-not-run.ts"]\n')
    await writeFile(join(isolatedDirectory, 'must-not-run.ts'), 'process.exit(91)\n')

    const environment = createEnvironment(configHome)
    const versionResult = Bun.spawnSync({
      cmd: [binaryPath, '--version'],
      cwd: isolatedDirectory,
      env: environment,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(versionResult.exitCode).toBe(0)
    expect(decoder.decode(versionResult.stdout).trim()).toBe('9.8.7')

    const dryRunResult = Bun.spawnSync({
      cmd: [binaryPath, '--dry-run'],
      cwd: isolatedDirectory,
      env: environment,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(dryRunResult.exitCode).toBe(0)
    expect(decoder.decode(dryRunResult.stdout)).toContain('# Resolved level: low')
  })
})
