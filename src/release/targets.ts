export interface ReleaseTarget {
  platform: 'linux'
  arch: 'x64' | 'arm64'
  bunTarget: 'bun-linux-x64-baseline' | 'bun-linux-arm64'
  executableName: 'cagent'
}

export interface ReleaseArtifact {
  target: ReleaseTarget
  directoryName: string
  executableName: ReleaseTarget['executableName']
  assetName: string
}

export const releaseTargets = [
  {
    platform: 'linux',
    arch: 'x64',
    bunTarget: 'bun-linux-x64-baseline',
    executableName: 'cagent',
  },
  {
    platform: 'linux',
    arch: 'arm64',
    bunTarget: 'bun-linux-arm64',
    executableName: 'cagent',
  },
] as const satisfies readonly ReleaseTarget[]

export function createReleaseArtifact(version: string, target: ReleaseTarget): ReleaseArtifact {
  const directoryName = `cagent-v${version}-${target.platform}-${target.arch}`

  return {
    target,
    directoryName,
    executableName: target.executableName,
    assetName: `${directoryName}.tar.gz`,
  }
}

export function findReleaseTarget(arch: ReleaseTarget['arch']): ReleaseTarget {
  const target = releaseTargets.find((candidate) => candidate.arch === arch)
  if (!target) {
    throw new Error(`Unsupported release architecture: ${arch}`)
  }
  return target
}
