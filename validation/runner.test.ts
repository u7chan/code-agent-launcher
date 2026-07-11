import { beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDryRunModel, loadMatrix, validateManualAttestation } from './runner.js'

describe('Codex validation matrix', () => {
  it('maps low, mid, and high to the agreed Codex models', () => {
    expect(loadMatrix().codex).toEqual({
      low: { expected_model: 'gpt-5.6-luna' },
      mid: { expected_model: 'gpt-5.6-terra' },
      high: { expected_model: 'gpt-5.6-sol' },
    })
  })

  it('recognizes the Codex model passed by cagent dry-run', () => {
    expect(
      assertDryRunModel('codex exec --model gpt-5.6-luna hello', 'gpt-5.6-luna', 'codex'),
    ).toBe(true)
    expect(assertDryRunModel('codex exec --model gpt-5.6-sol hello', 'gpt-5.6-luna', 'codex')).toBe(
      false,
    )
  })

  it('rejects Codex model when agent is opencode-go', () => {
    expect(
      assertDryRunModel('codex exec --model gpt-5.6-luna hello', 'gpt-5.6-luna', 'opencode-go'),
    ).toBe(false)
  })
})

describe('OpenCode validation matrix', () => {
  it('maps low, mid, and high to the agreed OpenCode models', () => {
    expect(loadMatrix()['opencode-go']).toEqual({
      low: { expected_model: 'opencode-go/deepseek-v4-flash' },
      mid: { expected_model: 'opencode-go/deepseek-v4-pro' },
      high: { expected_model: 'opencode-go/kimi-k2.7-code' },
    })
  })

  it('recognizes the OpenCode model passed by cagent dry-run', () => {
    expect(
      assertDryRunModel(
        'opencode run --model opencode-go/deepseek-v4-flash hello',
        'opencode-go/deepseek-v4-flash',
        'opencode-go',
      ),
    ).toBe(true)
    expect(
      assertDryRunModel(
        'opencode run --model opencode-go/deepseek-v4-pro hello',
        'opencode-go/deepseek-v4-flash',
        'opencode-go',
      ),
    ).toBe(false)
  })

  it('rejects OpenCode model when agent is codex', () => {
    expect(
      assertDryRunModel(
        'opencode run --model opencode-go/deepseek-v4-flash hello',
        'opencode-go/deepseek-v4-flash',
        'codex',
      ),
    ).toBe(false)
  })
})

describe('loadMatrix returns both agents', () => {
  it('has codex and opencode-go entries', () => {
    const matrix = loadMatrix()
    expect(Object.keys(matrix)).toContain('codex')
    expect(Object.keys(matrix)).toContain('opencode-go')
  })
})

describe('manual attestation', () => {
  it('accepts the documented Herdr pane schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-attestation-'))
    const path = join(directory, 'attestation.yaml')
    writeFileSync(
      path,
      `manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n`,
    )
    expect(validateManualAttestation(path, 'gpt-5.6-terra').status).toBe('pass')
  })

  it('rejects an attestation whose observed model differs from routing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-attestation-'))
    const path = join(directory, 'attestation.yaml')
    writeFileSync(
      path,
      `manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: another-model\n  status: pass\n`,
    )
    expect(validateManualAttestation(path, 'gpt-5.6-terra')).toMatchObject({ status: 'fail' })
  })
})

describe('extended smoke with fake CLIs', () => {
  beforeAll(() => {
    expect(spawnSync('bun', ['run', 'build'], { cwd: process.cwd() }).status).toBe(0)
  })

  function writeFake(directory: string, name: string, source: string): void {
    const path = join(directory, name)
    writeFileSync(path, `#!/bin/sh\n${source}\n`)
    chmodSync(path, 0o755)
  }

  function writeFakeBun(directory: string): void {
    writeFake(
      directory,
      'bun',
      `if [ "$1 $2" = "run build" ]; then exit 0; fi
exec ${process.execPath} "$@"`,
    )
  }

  function runExtended(fakePath: string, reportDir: string, attestation?: string) {
    return spawnSync(
      process.execPath,
      [
        'validation/runner.ts',
        'smoke',
        '--profile',
        'extended',
        '--report-dir',
        reportDir,
        ...(attestation ? ['--attestation', attestation] : []),
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakePath}:${process.env.PATH}`,
        },
      },
    )
  }

  it('records a passing fake Herdr launch and valid human attestation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFake(
      directory,
      'herdr',
      'case "$1 $2" in "pane current") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"current\\"}}}" ;; "pane split") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"new\\"}}}" ;; "pane run") exit 0 ;; *) exit 1 ;; esac',
    )
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    expect(runExtended(directory, reportDir, attestation).status).toBe(0)
    expect(readFileSync(join(reportDir, 'scores.json'), 'utf8')).toContain('"manual_attestation"')
  })

  it('fails deterministically when Herdr is unavailable or returns an error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    const absentReport = join(directory, 'absent-report')
    expect(runExtended(directory, absentReport).status).toBe(1)
    writeFake(directory, 'herdr', 'echo launch failed >&2; exit 9')
    const failedReport = join(directory, 'failed-report')
    expect(runExtended(directory, failedReport).status).toBe(1)
    expect(readFileSync(join(failedReport, 'scores.json'), 'utf8')).toContain(
      '"herdr_launch": "fail"',
    )
  })
})
