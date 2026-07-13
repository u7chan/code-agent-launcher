import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildStandalone, readPackageVersion } from '../src/release/build.js'
import { packStagedRelease, stageRelease } from '../src/release/pack.js'
import { createReleaseArtifact, findReleaseTarget, releaseTargets } from '../src/release/targets.js'

function parseArchitectures(arguments_: readonly string[]): Array<(typeof releaseTargets)[number]['arch']> {
  if (arguments_.length === 0) {
    return releaseTargets.map((target) => target.arch)
  }
  if (arguments_.length !== 2 || arguments_[0] !== '--arch') {
    throw new Error('Usage: bun run build:standalone [--arch x64|arm64]')
  }
  if (arguments_[1] !== 'x64' && arguments_[1] !== 'arm64') {
    throw new Error(`Unsupported release architecture: ${arguments_[1]}`)
  }
  return [arguments_[1]]
}

const projectRoot = join(import.meta.dir, '..')
const outputRoot = join(projectRoot, 'release')
const version = await readPackageVersion(join(projectRoot, 'package.json'))
const architectures = parseArchitectures(process.argv.slice(2))

await mkdir(outputRoot, { recursive: true })

for (const arch of architectures) {
  const target = findReleaseTarget(arch)
  const artifact = createReleaseArtifact(version, target)
  const binaryPath = join(outputRoot, '.build', artifact.directoryName, artifact.executableName)
  const stagingDirectory = await stageRelease({
    artifact,
    binaryPath: await buildStandalone({
      entrypoint: join(projectRoot, 'src', 'index.ts'),
      outfile: binaryPath,
      target,
      version,
    }),
    projectRoot,
    stagingRoot: join(outputRoot, '.stage'),
  })
  const archivePath = await packStagedRelease({
    artifact,
    archivePath: join(outputRoot, artifact.assetName),
    stagingDirectory,
  })

  console.log(`Built ${archivePath}`)
}
