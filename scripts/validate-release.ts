import { join } from 'node:path'
import { validateReleaseArchive } from '../src/release/archive.js'
import { readPackageVersion } from '../src/release/build.js'
import { createReleaseArtifact, findReleaseTarget } from '../src/release/targets.js'
import { validateReleaseTag } from '../src/release/validation.js'

interface Arguments {
  arch?: 'x64' | 'arm64'
  archive?: string
  tag: string
}

function usage(): never {
  throw new Error(
    'Usage: bun run release:validate -- --tag vX.Y.Z [--archive <path> --arch x64|arm64]',
  )
}

function parseArguments(arguments_: readonly string[]): Arguments {
  let tag: string | undefined
  let archive: string | undefined
  let arch: 'x64' | 'arm64' | undefined

  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    const value = arguments_[index + 1]
    if (!value) {
      usage()
    }
    if (option === '--tag') {
      tag = value
    } else if (option === '--archive') {
      archive = value
    } else if (option === '--arch' && (value === 'x64' || value === 'arm64')) {
      arch = value
    } else {
      usage()
    }
  }

  if (!tag || Boolean(archive) !== Boolean(arch)) {
    usage()
  }
  return { tag, archive, arch }
}

const projectRoot = join(import.meta.dir, '..')
const arguments_ = parseArguments(process.argv.slice(2))
const packageVersion = await readPackageVersion(join(projectRoot, 'package.json'))
validateReleaseTag(arguments_.tag, packageVersion)
console.log(`Validated release tag ${arguments_.tag}`)

if (arguments_.archive && arguments_.arch) {
  const artifact = createReleaseArtifact(packageVersion, findReleaseTarget(arguments_.arch))
  await validateReleaseArchive(arguments_.archive, artifact)
  console.log(`Validated release archive ${arguments_.archive}`)
}
