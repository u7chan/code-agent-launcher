import { describe, expect, it } from 'bun:test'
import { createReleaseArtifact, releaseTargets } from './targets.js'

describe('release targets', () => {
  it('centralizes the supported Linux targets and asset naming', () => {
    expect(releaseTargets).toEqual([
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
    ])

    expect(createReleaseArtifact('1.2.3', releaseTargets[0])).toEqual({
      target: releaseTargets[0],
      directoryName: 'cagent-v1.2.3-linux-x64',
      executableName: 'cagent',
      assetName: 'cagent-v1.2.3-linux-x64.tar.gz',
    })
  })
})
