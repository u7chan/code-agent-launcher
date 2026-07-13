import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReleaseTarget } from './targets.js'

export const VERSION_DEFINE = '__CAGENT_VERSION__'

export interface NodeBuildOptions {
  entrypoint: string
  outputDir: string
  version: string
}

export interface StandaloneBuildOptions {
  entrypoint: string
  outfile: string
  target: ReleaseTarget
  version: string
}

interface PackageMetadata {
  version?: unknown
}

export function createVersionDefine(version: string): Record<string, string> {
  if (!version) {
    throw new Error('package.json version must not be empty')
  }

  return { [VERSION_DEFINE]: JSON.stringify(version) }
}

export async function readPackageVersion(packageJsonPath: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageMetadata
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error(`package.json at ${packageJsonPath} must contain a non-empty version string`)
  }
  return packageJson.version
}

export function createNodeBuildConfig(options: NodeBuildOptions): Bun.BuildConfig {
  return {
    entrypoints: [options.entrypoint],
    outdir: options.outputDir,
    target: 'node',
    format: 'esm',
    sourcemap: 'linked',
    minify: {
      syntax: true,
    },
    define: createVersionDefine(options.version),
  }
}

export function createStandaloneBuildConfig(options: StandaloneBuildOptions): Bun.BuildConfig {
  return {
    entrypoints: [options.entrypoint],
    compile: {
      target: options.target.bunTarget,
      outfile: options.outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    minify: {
      syntax: true,
    },
    define: createVersionDefine(options.version),
  }
}

function formatBuildErrors(logs: Bun.BuildOutput['logs']): string {
  return logs.map((log) => log.message).join('\n')
}

async function ensureBuildSucceeded(result: Bun.BuildOutput): Promise<void> {
  if (!result.success) {
    throw new Error(`Build failed:\n${formatBuildErrors(result.logs)}`)
  }
}

export async function buildNode(options: NodeBuildOptions): Promise<string> {
  await rm(options.outputDir, { recursive: true, force: true })
  await mkdir(options.outputDir, { recursive: true })

  const result = await Bun.build(createNodeBuildConfig(options))
  await ensureBuildSucceeded(result)

  const outfile = join(options.outputDir, 'index.js')
  await chmod(outfile, 0o755)
  return outfile
}

export async function buildStandalone(options: StandaloneBuildOptions): Promise<string> {
  await mkdir(join(options.outfile, '..'), { recursive: true })

  const result = await Bun.build(createStandaloneBuildConfig(options))
  await ensureBuildSucceeded(result)

  await chmod(options.outfile, 0o755)
  return options.outfile
}
