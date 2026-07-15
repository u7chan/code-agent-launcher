import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const projectRoot = join(import.meta.dir, '..')
const preflight = join(projectRoot, 'skills', 'github-release', 'scripts', 'preflight.sh')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

function run(command: string[], cwd: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  }
}

function git(cwd: string, ...arguments_: string[]) {
  const result = run(['git', ...arguments_], cwd)
  expect(result.exitCode, `${arguments_.join(' ')}\n${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

async function createMockRepository(options: { workflow?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'github-release-skill-'))
  temporaryRoots.push(root)
  const origin = join(root, 'origin.git')
  const worktree = join(root, 'worktree')
  const mockBin = join(root, 'mock-bin')

  await mkdir(worktree)
  await mkdir(mockBin)
  git(root, 'init', '--bare', '--initial-branch=main', origin)
  git(worktree, 'init', '--initial-branch=main')
  git(worktree, 'config', 'user.name', 'Release Test')
  git(worktree, 'config', 'user.email', 'release-test@example.com')
  git(worktree, 'remote', 'add', 'origin', origin)
  await writeFile(join(worktree, 'package.json'), '{"name":"fixture","version":"1.2.3"}\n')
  if (options.workflow !== false) {
    await mkdir(join(worktree, '.github', 'workflows'), { recursive: true })
    await writeFile(
      join(worktree, '.github', 'workflows', 'release.yml'),
      "name: Release\non:\n  push:\n    tags: ['v*']\n",
    )
  }
  git(worktree, 'add', '.')
  git(worktree, 'commit', '-m', 'fixture')
  git(worktree, 'push', '-u', 'origin', 'main')

  const gh = join(mockBin, 'gh')
  await writeFile(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-} \${2:-}" in
  'repo view')
    printf '%s\\n' 'u7chan/code-agent-launcher'
    ;;
  'run list')
    if [[ "\${MOCK_GH_SCENARIO:-success}" == 'ci-query-error' ]]; then
      exit 1
    elif [[ "\${MOCK_GH_SCENARIO:-success}" == 'ci-failure' ]]; then
      printf '[{"databaseId":42,"headSha":"%s","status":"completed","conclusion":"failure","url":"https://github.test/actions/runs/42","workflowName":"CI"}]\\n' "$MOCK_SHA"
    else
      printf '[{"databaseId":41,"headSha":"%s","status":"completed","conclusion":"success","url":"https://github.test/actions/runs/41","workflowName":"CI"}]\\n' "$MOCK_SHA"
    fi
    ;;
  'api --paginate')
    if [[ "\${MOCK_GH_SCENARIO:-success}" == 'release-query-error' ]]; then
      exit 1
    elif [[ "\${MOCK_GH_SCENARIO:-success}" == 'release-exists' ]]; then
      printf '%s\\n' $'99\\ttrue\\thttps://github.test/releases/99'
    fi
    ;;
  *)
    printf 'unexpected gh arguments: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
  )
  await chmod(gh, 0o755)

  return { root, origin, worktree, mockBin }
}

function runPreflight(
  fixture: Awaited<ReturnType<typeof createMockRepository>>,
  tag = 'v1.2.3',
  scenario = 'success',
) {
  const sha = git(fixture.worktree, 'rev-parse', 'HEAD')
  return run(['bash', preflight, tag], fixture.worktree, {
    PATH: `${fixture.mockBin}:${process.env.PATH}`,
    MOCK_SHA: sha,
    MOCK_GH_SCENARIO: scenario,
  })
}

describe('github-release preflight safety stops', () => {
  it('reports the approval fields without creating a tag', async () => {
    const fixture = await createMockRepository()
    const result = runPreflight(fixture)

    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('Version: 1.2.3')
    expect(result.stdout).toContain(`Commit SHA: ${git(fixture.worktree, 'rev-parse', 'HEAD')}`)
    expect(result.stdout).toContain('CI result: success (https://github.test/actions/runs/41)')
    expect(result.stdout).toContain('Planned tag: v1.2.3')
    expect(git(fixture.worktree, 'tag', '--list')).toBe('')
    expect(git(fixture.worktree, 'ls-remote', '--tags', 'origin')).toBe('')
  })

  it('stops when the release workflow is not implemented', async () => {
    const fixture = await createMockRepository({ workflow: false })
    const result = runPreflight(fixture)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('release workflow is not present')
  })

  it('stops for a dirty worktree', async () => {
    const fixture = await createMockRepository()
    await writeFile(join(fixture.worktree, 'dirty.txt'), 'dirty')
    const result = runPreflight(fixture)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('worktree is not clean')
  })

  it('stops outside main', async () => {
    const fixture = await createMockRepository()
    git(fixture.worktree, 'switch', '-c', 'release-candidate')
    const result = runPreflight(fixture)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('current branch is not main')
  })

  it('stops when main is not synchronized with origin', async () => {
    const fixture = await createMockRepository()
    await writeFile(join(fixture.worktree, 'local-only.txt'), 'local')
    git(fixture.worktree, 'add', 'local-only.txt')
    git(fixture.worktree, 'commit', '-m', 'local only')
    const result = runPreflight(fixture)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('not synchronized')
  })

  it('stops for invalid or mismatched versions', async () => {
    const fixture = await createMockRepository()
    const invalid = runPreflight(fixture, 'v01.2.3')
    const mismatch = runPreflight(fixture, 'v1.2.4')
    expect(invalid.stderr).toContain('strict stable SemVer')
    expect(mismatch.stderr).toContain('does not match package.json version')
  })

  it('stops when CI did not succeed', async () => {
    const fixture = await createMockRepository()
    const result = runPreflight(fixture, 'v1.2.3', 'ci-failure')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('main CI is not successful')
  })

  it('stops when a local tag exists', async () => {
    const fixture = await createMockRepository()
    git(fixture.worktree, 'tag', 'v1.2.3')
    const result = runPreflight(fixture)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('local tag already exists')
  })

  it('stops when an origin tag exists', async () => {
    const fixture = await createMockRepository()
    git(fixture.worktree, 'tag', 'v1.2.3')
    git(fixture.worktree, 'push', 'origin', 'refs/tags/v1.2.3')
    git(fixture.worktree, 'tag', '--delete', 'v1.2.3')
    const result = runPreflight(fixture)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('origin tag already exists')
  })

  it('stops when a GitHub Release or draft exists', async () => {
    const fixture = await createMockRepository()
    const result = runPreflight(fixture, 'v1.2.3', 'release-exists')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('GitHub Release or draft already exists')
  })

  it('stops when GitHub absence or CI success cannot be verified', async () => {
    const fixture = await createMockRepository()
    const releaseQuery = runPreflight(fixture, 'v1.2.3', 'release-query-error')
    const ciQuery = runPreflight(fixture, 'v1.2.3', 'ci-query-error')
    expect(releaseQuery.exitCode).not.toBe(0)
    expect(releaseQuery.stderr).toContain('could not verify GitHub Release and draft absence')
    expect(ciQuery.exitCode).not.toBe(0)
    expect(ciQuery.stderr).toContain('could not query main CI runs')
  })
})

describe('github-release repository contract', () => {
  it('keeps mutating release commands out of preflight', async () => {
    const script = await readFile(preflight, 'utf8')
    expect(script).not.toContain('git tag ')
    expect(script).not.toContain('git push ')
    expect(script).not.toContain('gh workflow run')
    expect(script).not.toContain('gh release create')
    expect(script).not.toContain('gh release upload')
  })

  it('routes release requests and documents user and maintainer procedures', async () => {
    const [agents, readme, releasing, skill] = await Promise.all([
      readFile(join(projectRoot, 'AGENTS.md'), 'utf8'),
      readFile(join(projectRoot, 'README.md'), 'utf8'),
      readFile(join(projectRoot, 'docs', 'releasing.md'), 'utf8'),
      readFile(join(projectRoot, 'skills', 'github-release', 'SKILL.md'), 'utf8'),
    ])

    expect(agents).toContain('skills/github-release/SKILL.md')
    for (const heading of [
      'Linuxへのinstall',
      'Update',
      'Release integrityとattestation',
      'Uninstall',
      'Support範囲',
    ]) {
      expect(readme).toContain(heading)
    }
    expect(releasing).toContain('Prepare: Version更新PR')
    expect(releasing).toContain('Start: merge後のtag push')
    expect(releasing).toContain('初回Release rehearsal checklist')
    expect(skill).toContain('新たな明示承認')
    expect(skill).toContain('merge待ちで停止する')
  })
})
