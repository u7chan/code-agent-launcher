import { chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReleaseArtifact } from './targets.js'

const TAR_BLOCK_SIZE = 512
const ARCHIVE_MTIME = 0
const ROOT_UID = 0
const ROOT_GID = 0

export const RELEASE_ARCHIVE_FILES = ['cagent', 'README.md', 'LICENSE'] as const

export interface StageReleaseOptions {
  artifact: ReleaseArtifact
  binaryPath: string
  projectRoot: string
  stagingRoot: string
}

export interface PackReleaseOptions {
  artifact: ReleaseArtifact
  archivePath: string
  stagingDirectory: string
}

export interface TarEntry {
  name: string
  data: Uint8Array
  mode: number
  type: 'file' | 'directory'
}

async function assertRegularFile(path: string): Promise<void> {
  const file = await lstat(path)
  if (!file.isFile()) {
    throw new Error(`Expected a regular file: ${path}`)
  }
}

export async function stageRelease(options: StageReleaseOptions): Promise<string> {
  const stagingDirectory = join(options.stagingRoot, options.artifact.directoryName)
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })

  const files: ReadonlyArray<{
    source: string
    destination: (typeof RELEASE_ARCHIVE_FILES)[number]
  }> = [
    { source: options.binaryPath, destination: 'cagent' },
    { source: join(options.projectRoot, 'README.md'), destination: 'README.md' },
    { source: join(options.projectRoot, 'LICENSE'), destination: 'LICENSE' },
  ]

  for (const file of files) {
    await assertRegularFile(file.source)
    await copyFile(file.source, join(stagingDirectory, file.destination))
  }

  await chmod(join(stagingDirectory, 'cagent'), 0o755)
  await chmod(join(stagingDirectory, 'README.md'), 0o644)
  await chmod(join(stagingDirectory, 'LICENSE'), 0o644)

  return stagingDirectory
}

function writeString(buffer: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > length) {
    throw new Error(`Tar header value is too long: ${value}`)
  }
  buffer.set(bytes, offset)
}

function writeOctal(buffer: Uint8Array, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, '0')
  if (encoded.length > length - 1) {
    throw new Error(`Tar numeric value is too large: ${value}`)
  }
  writeString(buffer, offset, length - 1, encoded)
}

function createTarHeader(entry: TarEntry): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK_SIZE)
  const name = entry.type === 'directory' ? `${entry.name}/` : entry.name

  writeString(header, 0, 100, name)
  writeOctal(header, 100, 8, entry.mode)
  writeOctal(header, 108, 8, ROOT_UID)
  writeOctal(header, 116, 8, ROOT_GID)
  writeOctal(header, 124, 12, entry.data.length)
  writeOctal(header, 136, 12, ARCHIVE_MTIME)
  header.fill(0x20, 148, 156)
  header[156] = entry.type === 'directory' ? 0x35 : 0x30
  writeString(header, 257, 6, 'ustar\0')
  writeString(header, 263, 2, '00')

  let checksum = 0
  for (const byte of header) {
    checksum += byte
  }
  const encodedChecksum = checksum.toString(8).padStart(6, '0')
  writeString(header, 148, 6, encodedChecksum)
  header[154] = 0
  header[155] = 0x20

  return header
}

function padToTarBlock(data: Uint8Array): Uint8Array {
  const padding = (TAR_BLOCK_SIZE - (data.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE
  if (padding === 0) {
    return data
  }
  const padded = new Uint8Array(data.length + padding)
  padded.set(data)
  return padded
}

export function createDeterministicTarGz(entries: readonly TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const entry of entries) {
    blocks.push(createTarHeader(entry), padToTarBlock(entry.data))
  }
  blocks.push(new Uint8Array(TAR_BLOCK_SIZE * 2))

  const tar = new Uint8Array(blocks.reduce((size, block) => size + block.length, 0))
  let offset = 0
  for (const block of blocks) {
    tar.set(block, offset)
    offset += block.length
  }

  return Bun.gzipSync(tar, { level: 9, windowBits: 31 })
}

export async function packStagedRelease(options: PackReleaseOptions): Promise<string> {
  const entries: TarEntry[] = [
    {
      name: options.artifact.directoryName,
      data: new Uint8Array(),
      mode: 0o755,
      type: 'directory',
    },
  ]

  for (const file of RELEASE_ARCHIVE_FILES) {
    const path = join(options.stagingDirectory, file)
    await assertRegularFile(path)
    entries.push({
      name: `${options.artifact.directoryName}/${file}`,
      data: await readFile(path),
      mode: file === 'cagent' ? 0o755 : 0o644,
      type: 'file',
    })
  }

  await mkdir(join(options.archivePath, '..'), { recursive: true })
  await writeFile(options.archivePath, createDeterministicTarGz(entries))
  return options.archivePath
}
