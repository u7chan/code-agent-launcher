import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildNode,
  createNodeBuildConfig,
  createStandaloneBuildConfig,
  createVersionDefine,
  VERSION_DEFINE,
} from './build.js'
import { releaseTargets } from './targets.js'

describe('build configuration', () => {
  it('injects the package version as a build-time constant for the Node build', () => {
    const config = createNodeBuildConfig({
      entrypoint: '/project/src/index.ts',
      outputDir: '/project/dist',
      version: '1.2.3',
    })

    expect(config.define).toEqual({ [VERSION_DEFINE]: '"1.2.3"' })
    expect(config.target).toBe('node')
    expect(config.banner).toBeUndefined()
  })

  it('uses the shared version constant and disables standalone runtime autoloading', () => {
    const config = createStandaloneBuildConfig({
      entrypoint: '/project/src/index.ts',
      outfile: '/project/release/cagent',
      target: releaseTargets[0],
      version: '1.2.3',
    })

    expect(config.define).toEqual({ [VERSION_DEFINE]: '"1.2.3"' })
    expect(config.compile).toEqual({
      target: 'bun-linux-x64-baseline',
      outfile: '/project/release/cagent',
      autoloadDotenv: false,
      autoloadBunfig: false,
    })
  })

  it('rejects an empty version instead of producing an invalid build constant', () => {
    expect(() => createVersionDefine('')).toThrow('package.json version must not be empty')
  })

  it('runs outside the repository without a package.json at runtime', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'cagent-node-build-test-'))
    try {
      const outfile = await buildNode({
        entrypoint: join(import.meta.dir, '..', 'index.ts'),
        outputDir: join(outputDirectory, 'dist'),
        version: '9.8.7',
      })
      const result = Bun.spawnSync({
        cmd: ['node', outfile, '--version'],
        cwd: outputDirectory,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      expect(result.exitCode).toBe(0)
      expect(new TextDecoder().decode(result.stdout).trim()).toBe('9.8.7')
      expect(await readFile(outfile, 'utf8')).not.toContain('__CAGENT_VERSION__')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
})
