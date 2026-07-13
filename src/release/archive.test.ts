import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateReleaseArchive } from './archive.js'
import { createDeterministicTarGz, type TarEntry } from './pack.js'
import { createReleaseArtifact, releaseTargets } from './targets.js'

const artifact = createReleaseArtifact('1.2.3', releaseTargets[0])

function validEntries(): TarEntry[] {
  return [
    {
      name: artifact.directoryName,
      data: new Uint8Array(),
      mode: 0o755,
      type: 'directory',
    },
    {
      name: `${artifact.directoryName}/cagent`,
      data: new TextEncoder().encode('binary'),
      mode: 0o755,
      type: 'file',
    },
    {
      name: `${artifact.directoryName}/README.md`,
      data: new TextEncoder().encode('readme'),
      mode: 0o644,
      type: 'file',
    },
    {
      name: `${artifact.directoryName}/LICENSE`,
      data: new TextEncoder().encode('license'),
      mode: 0o644,
      type: 'file',
    },
  ]
}

describe('release archive validation', () => {
  let root: string
  let archivePath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cagent-archive-validation-test-'))
    archivePath = join(root, artifact.assetName)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function validate(entries: readonly TarEntry[]): Promise<void> {
    await writeFile(archivePath, createDeterministicTarGz(entries))
    await validateReleaseArchive(archivePath, artifact)
  }

  it('accepts the expected archive without extracting it', async () => {
    await expect(validate(validEntries())).resolves.toBeUndefined()
  })

  it('rejects an absolute path', async () => {
    await expect(
      validate([
        ...validEntries(),
        { name: '/tmp/evil', data: new Uint8Array(), mode: 0o644, type: 'file' },
      ]),
    ).rejects.toThrow('Archive contains an absolute path: /tmp/evil')
  })

  it('rejects parent traversal', async () => {
    await expect(
      validate([
        ...validEntries(),
        {
          name: `${artifact.directoryName}/../evil`,
          data: new Uint8Array(),
          mode: 0o644,
          type: 'file',
        },
      ]),
    ).rejects.toThrow('Archive contains parent traversal')
  })

  it('rejects a symbolic link', async () => {
    const entries = validEntries()
    entries[1] = { ...entries[1], data: new Uint8Array(), type: 'symlink' }

    await expect(validate(entries)).rejects.toThrow('Archive contains a symbolic link')
  })

  it('rejects an unexpected entry', async () => {
    await expect(
      validate([
        ...validEntries(),
        {
          name: `${artifact.directoryName}/unexpected.txt`,
          data: new Uint8Array(),
          mode: 0o644,
          type: 'file',
        },
      ]),
    ).rejects.toThrow('Archive contains an unexpected entry')
  })

  it('rejects an archive with a required entry missing', async () => {
    await expect(validate(validEntries().slice(0, -1))).rejects.toThrow(
      `Archive is missing required entries: ${artifact.directoryName}/LICENSE`,
    )
  })

  it.each([
    ['0o644', 0o644],
    ['0o001', 0o001],
    ['0o010', 0o010],
  ])('rejects cagent without owner execute permission: %s', async (_label, mode) => {
    const entries = validEntries()
    entries[1] = { ...entries[1], mode }

    await expect(validate(entries)).rejects.toThrow('Archive executable is not executable by owner')
  })
})
