import { join } from 'node:path'
import { validateReleaseArchive } from '../src/release/archive.js'
import { readPackageVersion } from '../src/release/build.js'
import { verifySha256Checksums, writeSha256Checksums } from '../src/release/checksum.js'
import { runStandaloneSmoke } from '../src/release/smoke.js'
import { createReleaseArtifact, findReleaseTarget } from '../src/release/targets.js'
import { validateReleaseTag } from '../src/release/validation.js'

if (process.platform !== 'linux' || (process.arch !== 'x64' && process.arch !== 'arm64')) {
  throw new Error(
    'Release preflight requires a Linux x64 or arm64 host for the native standalone smoke test',
  )
}

const projectRoot = join(import.meta.dir, '..')
const outputRoot = join(projectRoot, 'release')
const version = await readPackageVersion(join(projectRoot, 'package.json'))
validateReleaseTag(`v${version}`, version)
const architecture = process.arch

const buildResult = Bun.spawnSync({
  cmd: [
    process.execPath,
    join(projectRoot, 'scripts', 'build-standalone.ts'),
    '--arch',
    architecture,
  ],
  cwd: projectRoot,
  env: process.env,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (buildResult.exitCode !== 0) {
  throw new Error(
    `Linux ${architecture} standalone build failed with exit code ${buildResult.exitCode}`,
  )
}

const artifact = createReleaseArtifact(version, findReleaseTarget(architecture))
const archivePath = join(outputRoot, artifact.assetName)
await validateReleaseArchive(archivePath, artifact)
console.log(`Validated ${archivePath}`)

const checksumPath = join(outputRoot, 'SHA256SUMS')
await writeSha256Checksums([archivePath], checksumPath)
await verifySha256Checksums(checksumPath, outputRoot, [artifact.assetName])
console.log(`Generated and verified ${checksumPath}`)

const binaryPath = join(outputRoot, '.build', artifact.directoryName, artifact.executableName)
await runStandaloneSmoke({ binaryPath, version })
console.log(`Passed isolated Linux ${architecture} standalone smoke test`)
