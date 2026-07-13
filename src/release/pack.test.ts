import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packStagedRelease, RELEASE_ARCHIVE_FILES, stageRelease } from './pack.js'
import { createReleaseArtifact, releaseTargets } from './targets.js'

interface ParsedTarEntry {
  gid: number
  mode: number
  mtime: number
  name: string
  type: string
  uid: number
}

const decoder = new TextDecoder()

function readTarString(data: Uint8Array<ArrayBufferLike>, offset: number, length: number): string {
  return decoder.decode(data.slice(offset, offset + length)).replace(/\0.*$/, '')
}

function readTarOctal(data: Uint8Array<ArrayBufferLike>, offset: number, length: number): number {
  const value = readTarString(data, offset, length).trim()
  return value ? Number.parseInt(value, 8) : 0
}

function readTarEntries(archive: Uint8Array): ParsedTarEntry[] {
  const tar = Bun.gunzipSync(archive as Uint8Array<ArrayBuffer>)
  const entries: ParsedTarEntry[] = []
  let offset = 0

  while (offset < tar.length && tar[offset] !== 0) {
    const size = readTarOctal(tar, offset + 124, 12)
    entries.push({
      name: readTarString(tar, offset, 100),
      mode: readTarOctal(tar, offset + 100, 8),
      uid: readTarOctal(tar, offset + 108, 8),
      gid: readTarOctal(tar, offset + 116, 8),
      mtime: readTarOctal(tar, offset + 136, 12),
      type: String.fromCharCode(tar[offset + 156]),
    })
    offset += 512 + Math.ceil(size / 512) * 512
  }

  return entries
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

describe('release archive packing', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cagent-pack-test-'))
    await mkdir(join(root, 'project'), { recursive: true })
    await writeFile(join(root, 'binary'), 'standalone binary')
    await chmod(join(root, 'binary'), 0o700)
    await writeFile(join(root, 'project', 'README.md'), 'readme')
    await writeFile(join(root, 'project', 'LICENSE'), 'license')
    await writeFile(join(root, 'project', 'not-in-release.txt'), 'must not be packaged')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('stages only the allowlisted files and emits a deterministic archive', async () => {
    const artifact = createReleaseArtifact('1.2.3', releaseTargets[0])
    const stagingDirectory = await stageRelease({
      artifact,
      binaryPath: join(root, 'binary'),
      projectRoot: join(root, 'project'),
      stagingRoot: join(root, 'stage'),
    })

    expect((await readdir(stagingDirectory)).sort()).toEqual([...RELEASE_ARCHIVE_FILES].sort())
    expect((await stat(join(stagingDirectory, 'cagent'))).mode & 0o777).toBe(0o755)
    expect((await stat(join(stagingDirectory, 'README.md'))).mode & 0o777).toBe(0o644)

    const firstPath = await packStagedRelease({
      artifact,
      stagingDirectory,
      archivePath: join(root, 'first.tar.gz'),
    })
    const secondPath = await packStagedRelease({
      artifact,
      stagingDirectory,
      archivePath: join(root, 'second.tar.gz'),
    })
    const first = await readFile(firstPath)
    const second = await readFile(secondPath)

    expect(first).toEqual(second)
    expect(sha256(first)).toBe(sha256(second))
    expect([...first.slice(4, 8)]).toEqual([0, 0, 0, 0])

    expect(readTarEntries(first)).toEqual([
      {
        name: 'cagent-v1.2.3-linux-x64/',
        mode: 0o755,
        uid: 0,
        gid: 0,
        mtime: 0,
        type: '5',
      },
      {
        name: 'cagent-v1.2.3-linux-x64/cagent',
        mode: 0o755,
        uid: 0,
        gid: 0,
        mtime: 0,
        type: '0',
      },
      {
        name: 'cagent-v1.2.3-linux-x64/README.md',
        mode: 0o644,
        uid: 0,
        gid: 0,
        mtime: 0,
        type: '0',
      },
      {
        name: 'cagent-v1.2.3-linux-x64/LICENSE',
        mode: 0o644,
        uid: 0,
        gid: 0,
        mtime: 0,
        type: '0',
      },
    ])
  })
})
