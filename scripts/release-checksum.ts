import { verifySha256Checksums, writeSha256Checksums } from '../src/release/checksum.js'

function usage(): never {
  throw new Error(
    'Usage: bun run release:checksum -- generate <checksum-file> <artifact...> | verify <checksum-file> <artifact-directory> [required-artifact...]',
  )
}

const [command, checksumPath, path, ...rest] = process.argv.slice(2)
if (command === 'generate' && checksumPath && path) {
  const artifacts = [path, ...rest]
  await writeSha256Checksums(artifacts, checksumPath)
  console.log(`Generated ${checksumPath}`)
} else if (command === 'verify' && checksumPath && path) {
  await verifySha256Checksums(checksumPath, path, rest)
  console.log(`Verified ${checksumPath}`)
} else {
  usage()
}
