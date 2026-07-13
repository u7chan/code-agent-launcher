import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { RELEASE_ARCHIVE_FILES } from './pack.js'
import type { ReleaseArtifact } from './targets.js'

const TAR_BLOCK_SIZE = 512
const decoder = new TextDecoder()

export interface ArchiveEntry {
  mode: number
  name: string
  size: number
  type: string
}

function readTarString(data: Uint8Array, offset: number, length: number): string {
  return decoder.decode(data.slice(offset, offset + length)).replace(/\0.*$/, '')
}

function readTarOctal(data: Uint8Array, offset: number, length: number, field: string): number {
  const value = readTarString(data, offset, length).trim()
  if (!value) {
    return 0
  }
  if (!/^[0-7]+$/.test(value)) {
    throw new Error(`Invalid tar ${field}: ${value}`)
  }
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Tar ${field} is too large: ${value}`)
  }
  return parsed
}

function isZeroBlock(data: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + TAR_BLOCK_SIZE; index += 1) {
    if (data[index] !== 0) {
      return false
    }
  }
  return true
}

function validateHeaderChecksum(data: Uint8Array, offset: number): void {
  const expected = readTarOctal(data, offset + 148, 8, 'header checksum')
  let actual = 0
  for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : (data[offset + index] ?? 0)
  }
  if (actual !== expected) {
    throw new Error(`Invalid tar header checksum: expected ${expected}, got ${actual}`)
  }
}

export function readArchiveEntries(archive: Uint8Array): ArchiveEntry[] {
  const tar = Bun.gunzipSync(archive as Uint8Array<ArrayBuffer>)
  const entries: ArchiveEntry[] = []
  let offset = 0

  while (offset < tar.length) {
    if (offset + TAR_BLOCK_SIZE > tar.length) {
      throw new Error('Truncated tar header')
    }
    if (isZeroBlock(tar, offset)) {
      break
    }

    validateHeaderChecksum(tar, offset)
    const size = readTarOctal(tar, offset + 124, 12, 'entry size')
    const name = readTarString(tar, offset, 100)
    const prefix = readTarString(tar, offset + 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const dataBlocks = Math.ceil(size / TAR_BLOCK_SIZE)
    const nextOffset = offset + TAR_BLOCK_SIZE + dataBlocks * TAR_BLOCK_SIZE
    if (nextOffset > tar.length) {
      throw new Error(`Truncated tar entry: ${fullName}`)
    }

    entries.push({
      name: fullName,
      mode: readTarOctal(tar, offset + 100, 8, 'entry mode'),
      size,
      type: tar[offset + 156] === 0 ? '0' : String.fromCharCode(tar[offset + 156]),
    })
    offset = nextOffset
  }

  return entries
}

function validateEntryPath(name: string): void {
  if (posix.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name) || name.startsWith('\\\\')) {
    throw new Error(`Archive contains an absolute path: ${name}`)
  }
  if (name.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`Archive contains parent traversal: ${name}`)
  }
}

export function validateArchiveEntries(
  entries: readonly ArchiveEntry[],
  artifact: ReleaseArtifact,
): void {
  const expectedEntries = new Map<string, '0' | '5'>([
    [`${artifact.directoryName}/`, '5'],
    ...RELEASE_ARCHIVE_FILES.map((file) => [`${artifact.directoryName}/${file}`, '0'] as const),
  ])
  const seen = new Set<string>()

  for (const entry of entries) {
    validateEntryPath(entry.name)
    if (entry.type === '2') {
      throw new Error(`Archive contains a symbolic link: ${entry.name}`)
    }

    const expectedType = expectedEntries.get(entry.name)
    if (!expectedType) {
      throw new Error(`Archive contains an unexpected entry: ${entry.name}`)
    }
    if (seen.has(entry.name)) {
      throw new Error(`Archive contains a duplicate entry: ${entry.name}`)
    }
    if (entry.type !== expectedType) {
      throw new Error(
        `Archive entry has an unexpected type: ${entry.name} (${entry.type || 'NUL'})`,
      )
    }
    if (entry.name === `${artifact.directoryName}/${artifact.executableName}`) {
      if ((entry.mode & 0o100) === 0) {
        throw new Error(`Archive executable is not executable by owner: ${entry.name}`)
      }
    }
    seen.add(entry.name)
  }

  const missing = [...expectedEntries.keys()].filter((name) => !seen.has(name))
  if (missing.length > 0) {
    throw new Error(`Archive is missing required entries: ${missing.join(', ')}`)
  }
}

export async function validateReleaseArchive(
  archivePath: string,
  artifact: ReleaseArtifact,
): Promise<void> {
  validateArchiveEntries(readArchiveEntries(await readFile(archivePath)), artifact)
}
