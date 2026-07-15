import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
