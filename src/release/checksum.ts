import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface Sha256Checksum {
  digest: string
  filename: string
}

export async function calculateSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function validateArtifactFilename(filename: string): void {
  if (!filename || basename(filename) !== filename || filename === '.' || filename === '..') {
    throw new Error(`Invalid checksum artifact filename: ${filename}`)
  }
}

export async function writeSha256Checksums(
  artifactPaths: readonly string[],
  checksumPath: string,
): Promise<Sha256Checksum[]> {
  if (artifactPaths.length === 0) {
    throw new Error('At least one artifact is required to generate checksums')
  }

  const checksums = await Promise.all(
    artifactPaths.map(async (path) => ({
      digest: await calculateSha256(path),
      filename: basename(path),
    })),
  )
  checksums.sort((left, right) => left.filename.localeCompare(right.filename))

  const filenames = new Set<string>()
  for (const checksum of checksums) {
    validateArtifactFilename(checksum.filename)
    if (filenames.has(checksum.filename)) {
      throw new Error(`Duplicate checksum artifact filename: ${checksum.filename}`)
    }
    filenames.add(checksum.filename)
  }

  await mkdir(dirname(checksumPath), { recursive: true })
  await writeFile(
    checksumPath,
    `${checksums.map(({ digest, filename }) => `${digest}  ${filename}`).join('\n')}\n`,
  )
  return checksums
}

export function parseSha256Checksums(content: string): Sha256Checksum[] {
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  if (lines.length === 0) {
    throw new Error('Checksum file must contain at least one entry')
  }

  const checksums: Sha256Checksum[] = []
  const filenames = new Set<string>()
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
    if (!match) {
      throw new Error(`Invalid SHA-256 checksum line: ${line}`)
    }
    const [, digest, filename] = match
    validateArtifactFilename(filename)
    if (filenames.has(filename)) {
      throw new Error(`Duplicate checksum artifact filename: ${filename}`)
    }
    filenames.add(filename)
    checksums.push({ digest, filename })
  }
  return checksums
}

export async function verifySha256Checksums(
  checksumPath: string,
  artifactDirectory: string,
  requiredFilenames: readonly string[] = [],
): Promise<Sha256Checksum[]> {
  const checksums = parseSha256Checksums(await readFile(checksumPath, 'utf8'))
  const checksummedFilenames = new Set(checksums.map(({ filename }) => filename))

  for (const filename of requiredFilenames) {
    validateArtifactFilename(filename)
    if (!checksummedFilenames.has(filename)) {
      throw new Error(`Checksum file is missing required artifact: ${filename}`)
    }
  }

  for (const checksum of checksums) {
    const actual = await calculateSha256(join(artifactDirectory, checksum.filename))
    if (actual !== checksum.digest) {
      throw new Error(
        `SHA-256 checksum mismatch for ${checksum.filename}: expected ${checksum.digest}, got ${actual}`,
      )
    }
  }
  return checksums
}
