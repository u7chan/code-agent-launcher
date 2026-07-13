import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSha256Checksums, verifySha256Checksums, writeSha256Checksums } from './checksum.js'

describe('SHA-256 checksums', () => {
  let root: string
  let artifactPath: string
  let checksumPath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cagent-checksum-test-'))
    artifactPath = join(root, 'cagent-v1.2.3-linux-x64.tar.gz')
    checksumPath = join(root, 'SHA256SUMS')
    await writeFile(artifactPath, 'release artifact')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('generates and verifies a reusable SHA-256 checksum file', async () => {
    const generated = await writeSha256Checksums([artifactPath], checksumPath)
    const content = await readFile(checksumPath, 'utf8')

    expect(generated).toHaveLength(1)
    expect(content).toBe(`${generated[0].digest}  cagent-v1.2.3-linux-x64.tar.gz\n`)
    await expect(
      verifySha256Checksums(checksumPath, root, ['cagent-v1.2.3-linux-x64.tar.gz']),
    ).resolves.toEqual(generated)
  })

  it('rejects an artifact whose contents changed after checksum generation', async () => {
    await writeSha256Checksums([artifactPath], checksumPath)
    await writeFile(artifactPath, 'tampered artifact')

    await expect(verifySha256Checksums(checksumPath, root)).rejects.toThrow(
      'SHA-256 checksum mismatch',
    )
  })

  it('rejects unsafe or malformed checksum entries', () => {
    expect(() => parseSha256Checksums(`${'0'.repeat(64)}  ../artifact\n`)).toThrow(
      'Invalid checksum artifact filename',
    )
    expect(() => parseSha256Checksums('not-a-checksum\n')).toThrow('Invalid SHA-256 checksum line')
  })

  it('requires explicitly requested artifacts to be listed', async () => {
    await writeSha256Checksums([artifactPath], checksumPath)

    await expect(
      verifySha256Checksums(checksumPath, root, ['cagent-v1.2.3-linux-arm64.tar.gz']),
    ).rejects.toThrow('Checksum file is missing required artifact')
  })
})
