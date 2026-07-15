import { describe, expect, it } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { writeSha256Checksums } from './checksum.js'

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface ReleaseAsset {
  digest: string
  name: string
  size: number
  state: string
}

interface WorkflowJob {
  environment?: string
  needs?: string | string[]
  permissions?: Record<string, string>
  steps: WorkflowStep[]
}

interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>
  on: Record<string, unknown>
  permissions: Record<string, string>
}

const projectRoot = join(import.meta.dir, '..', '..')
const workflowPath = join(projectRoot, '.github', 'workflows', 'release.yml')
const workflow = parse(await readFile(workflowPath, 'utf8')) as ReleaseWorkflow
const refNameExpression = '$' + '{{ github.ref_name }}'

async function runVerifyDraftStep(
  scenario: string,
  mutateRelease?: (release: {
    assets: ReleaseAsset[]
    draft: boolean
    id: number
    tag_name: string
  }) => void,
) {
  const root = await mkdtemp(join(tmpdir(), 'cagent-release-publish-test-'))
  const releaseDirectory = join(root, 'release')
  const mockBin = join(root, 'bin')
  const tag = 'v1.2.3'
  const x64Name = `cagent-${tag}-linux-x64.tar.gz`
  const arm64Name = `cagent-${tag}-linux-arm64.tar.gz`
  const x64 = join(releaseDirectory, x64Name)
  const arm64 = join(releaseDirectory, arm64Name)
  const checksums = join(releaseDirectory, 'SHA256SUMS')
  const queryCount = join(root, 'query-count')
  const patchMarker = join(root, 'patched')
  await mkdir(releaseDirectory)
  await mkdir(mockBin)
  await writeFile(x64, 'x64 archive')
  await writeFile(arm64, 'arm64 archive')
  await writeSha256Checksums([x64, arm64], checksums)

  const digest = async (path: string) =>
    `sha256:${new Bun.CryptoHasher('sha256').update(await readFile(path)).digest('hex')}`
  const release = {
    id: 123,
    tag_name: tag,
    draft: true,
    assets: [
      { name: x64Name, state: 'uploaded', size: 11, digest: await digest(x64) },
      { name: arm64Name, state: 'uploaded', size: 13, digest: await digest(arm64) },
      { name: 'SHA256SUMS', state: 'uploaded', size: 42, digest: await digest(checksums) },
    ],
  }
  mutateRelease?.(release)

  const gh = `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *' --paginate '* ]]; then
  count="$(cat "$MOCK_QUERY_COUNT" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s' "$count" > "$MOCK_QUERY_COUNT"
  case "$MOCK_SCENARIO" in
    delayed) (( count >= 3 )) && printf '123\\n' ;;
    missing) ;;
    multiple) printf '123\\n124\\n' ;;
    invalid) printf 'not-an-id\\n' ;;
    *) printf '123\\n' ;;
  esac
  exit 0
fi
if [[ " $* " == *' --method PATCH '* ]]; then
  printf 'patched\\n' > "$MOCK_PATCH_MARKER"
  exit 0
fi
printf '%s\\n' "$MOCK_RELEASE_JSON"
`
  await writeFile(join(mockBin, 'gh'), gh)
  await writeFile(join(mockBin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n')
  await chmod(join(mockBin, 'gh'), 0o755)
  await chmod(join(mockBin, 'sleep'), 0o755)

  const verification = workflow.jobs.publish?.steps.find(
    (step) => step.name === 'Verify draft and publish',
  )
  const result = Bun.spawnSync({
    cmd: ['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', verification?.run ?? ''],
    cwd: root,
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      GITHUB_REF_NAME: tag,
      GITHUB_REPOSITORY: 'example/repository',
      MOCK_PATCH_MARKER: patchMarker,
      MOCK_QUERY_COUNT: queryCount,
      MOCK_RELEASE_JSON: JSON.stringify(release),
      MOCK_SCENARIO: scenario,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    exitCode: result.exitCode,
    patchMarker,
    patched: await Bun.file(patchMarker).exists(),
    queryCount: Number(await readFile(queryCount, 'utf8')),
    root,
    stderr: new TextDecoder().decode(result.stderr),
  }
}

describe('release workflow security boundaries', () => {
  it('only starts for stable SemVer-shaped tag pushes', () => {
    expect(workflow.on).toEqual({
      push: {
        tags: ['v[0-9]+.[0-9]+.[0-9]+'],
      },
    })
  })

  it('pins every action to a full commit SHA', () => {
    const actions = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
    )

    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
    }
  })

  it('contains syntactically valid bash commands', () => {
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (!step.run) {
          continue
        }
        const result = Bun.spawnSync({
          cmd: ['bash', '-n'],
          stdin: new Blob([step.run]),
          stdout: 'pipe',
          stderr: 'pipe',
        })
        expect(new TextDecoder().decode(result.stderr), `${jobName}: ${step.name}`).toBe('')
        expect(result.exitCode, `${jobName}: ${step.name}`).toBe(0)
      }
    }
  })

  it('uses attempt-specific artifacts without overwrite or broad downloads', () => {
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps)
    const uploads = steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
    const downloads = steps.filter((step) => step.uses?.startsWith('actions/download-artifact@'))

    for (const upload of uploads) {
      expect(upload.with?.name).toContain(refNameExpression.replace('ref_name', 'run_id'))
      expect(upload.with?.name).toContain(refNameExpression.replace('ref_name', 'run_attempt'))
      expect(upload.with?.overwrite).toBe(false)
    }
    for (const download of downloads) {
      expect(download.with?.name).toBeDefined()
      expect(download.with?.pattern).toBeUndefined()
    }
  })

  it('keeps write and OIDC permissions away from repository code execution', () => {
    expect(workflow.permissions).toEqual({})
    expect(workflow.jobs['validate-build']?.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs['native-smoke']?.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.attest?.permissions).toEqual({
      contents: 'read',
      'id-token': 'write',
      attestations: 'write',
    })
    expect(workflow.jobs.publish?.permissions).toEqual({ contents: 'write' })

    for (const jobName of ['attest', 'publish']) {
      const actions = workflow.jobs[jobName]?.steps.flatMap((step) =>
        step.uses ? [step.uses] : [],
      )
      expect(actions).not.toContainEqual(expect.stringContaining('actions/checkout@'))
      expect(actions).not.toContainEqual(expect.stringContaining('oven-sh/setup-bun@'))
    }
  })

  it('waits for the release environment before creating a non-overwritable draft', () => {
    const publish = workflow.jobs.publish
    expect(publish?.environment).toBe('release')
    expect(publish?.needs).toBe('attest')

    const commands = publish?.steps.flatMap((step) => (step.run ? [step.run] : [])).join('\n')
    expect(commands).toContain('gh release create')
    expect(commands).toContain('--draft')
    expect(commands).toContain('--verify-tag')
    expect(commands).toContain('gh release upload')
    expect(commands).toContain('gh api --method PATCH')
    expect(commands).toContain('-F draft=false')
    expect(commands).toContain('.draft == true')
    expect(commands).not.toContain('/releases/tags/')
    expect(commands).not.toContain('--clobber')
  })

  it('retries a temporarily invisible exact-tag draft before publishing it', async () => {
    const result = await runVerifyDraftStep('delayed')
    try {
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.queryCount).toBe(3)
      expect(result.patched).toBe(true)
      expect(await readFile(result.patchMarker, 'utf8')).toBe('patched\n')
    } finally {
      await rm(result.root, { recursive: true, force: true })
    }
  })

  it('fails closed when draft discovery never converges or returns unsafe IDs', async () => {
    for (const [scenario, expectedQueries] of [
      ['missing', 6],
      ['multiple', 1],
      ['invalid', 1],
    ] as const) {
      const result = await runVerifyDraftStep(scenario)
      try {
        expect(result.exitCode, scenario).not.toBe(0)
        expect(result.queryCount, scenario).toBe(expectedQueries)
        expect(result.patched, scenario).toBe(false)
      } finally {
        await rm(result.root, { recursive: true, force: true })
      }
    }
  })

  it('fails closed when draft identity, assets, or digests do not match', async () => {
    const cases: Array<
      [
        string,
        (release: { assets: ReleaseAsset[]; draft: boolean; id: number; tag_name: string }) => void,
      ]
    > = [
      ['tag', (release) => (release.tag_name = 'v9.9.9')],
      ['draft', (release) => (release.draft = false)],
      ['id', (release) => (release.id = 456)],
      ['assets', (release) => release.assets.pop()],
      ['digest', (release) => (release.assets[0].digest = 'sha256:incorrect')],
    ]

    for (const [name, mutate] of cases) {
      const result = await runVerifyDraftStep('success', mutate)
      try {
        expect(result.exitCode, name).not.toBe(0)
        expect(result.queryCount, name).toBe(1)
        expect(result.patched, name).toBe(false)
        expect(result.stderr, name).toContain('Draft is not complete and ready for publication')
      } finally {
        await rm(result.root, { recursive: true, force: true })
      }
    }
  })

  it('accepts the exact downloaded asset set before creating a draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cagent-release-workflow-test-'))
    const releaseDirectory = join(root, 'release')
    const tag = 'v1.2.3'
    const x64 = join(releaseDirectory, `cagent-${tag}-linux-x64.tar.gz`)
    const arm64 = join(releaseDirectory, `cagent-${tag}-linux-arm64.tar.gz`)
    await mkdir(releaseDirectory)
    await writeFile(x64, 'x64 archive')
    await writeFile(arm64, 'arm64 archive')
    await writeSha256Checksums([x64, arm64], join(releaseDirectory, 'SHA256SUMS'))

    try {
      const validation = workflow.jobs.publish?.steps.find(
        (step) => step.name === 'Validate assets before creating draft',
      )
      const result = Bun.spawnSync({
        cmd: ['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', validation?.run ?? ''],
        cwd: root,
        env: { ...process.env, GITHUB_REF_NAME: tag },
        stdout: 'pipe',
        stderr: 'pipe',
      })

      expect(new TextDecoder().decode(result.stderr)).toBe('')
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('attests only the two release archives', () => {
    const attestStep = workflow.jobs.attest?.steps.find((step) =>
      step.uses?.startsWith('actions/attest@'),
    )
    const subjectPath = attestStep?.with?.['subject-path']

    expect(subjectPath).toBe(
      [
        `release/cagent-${refNameExpression}-linux-x64.tar.gz`,
        `release/cagent-${refNameExpression}-linux-arm64.tar.gz`,
        '',
      ].join('\n'),
    )
  })
})
