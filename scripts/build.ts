import { join } from 'node:path'
import { buildNode, readPackageVersion } from '../src/release/build.js'

const projectRoot = join(import.meta.dir, '..')
const version = await readPackageVersion(join(projectRoot, 'package.json'))
const outfile = await buildNode({
  entrypoint: join(projectRoot, 'src', 'index.ts'),
  outputDir: join(projectRoot, 'dist'),
  version,
})

console.log(`Built ${outfile}`)
