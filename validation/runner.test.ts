import { beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertDryRunModel,
  evaluate,
  evaluateInvocation,
  loadMatrix,
  validateManualAttestation,
} from './runner.js'

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

  function runExtended(fakePath: string, reportDir: string, extraArgs: string[] = []) {
    return spawnSync(
      process.execPath,
      [
        'validation/runner.ts',
        'smoke',
        '--profile',
        'extended',
        '--report-dir',
        reportDir,
        ...extraArgs,
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

  function writeFakeHerdrPassing(directory: string): void {
    writeFake(
      directory,
      'herdr',
      'case "$1 $2" in "pane current") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"current\\"}}}" ;; "pane split") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"new-pane-42\\"}}}" ;; "pane run") exit 0 ;; "pane close") exit 0 ;; *) exit 1 ;; esac',
    )
  }

  it('default extended smoke does not call herdr pane split/run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    expect(runExtended(directory, reportDir, ['--attestation', attestation]).status).toBe(0)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).not.toContain('"herdr_live"')
    expect(scores).toContain('"automatic_routing"')
    expect(scores).toContain('"manual_attestation"')
  })

  it('default extended smoke passes without attestation when dry-run checks succeed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const reportDir = join(directory, 'report')
    expect(runExtended(directory, reportDir).status).toBe(1)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"manual_attestation"')
    expect(scores).toContain('"not_provided"')
  })

  it('--live alone does not launch herdr and fails with diagnostic', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, ['--attestation', attestation, '--live'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--confirm-herdr-side-effects')
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"authorized": false')
    expect(scores).toContain('"herdr_live"')
    expect(scores).not.toContain('"current"')
    expect(scores).not.toContain('"split"')
  })

  it('--confirm-herdr-side-effects alone does not launch herdr and fails with diagnostic', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--confirm-herdr-side-effects',
    ])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--live')
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"authorized": false')
  })

  it('--live --confirm-herdr-side-effects launches herdr with step tracking and keeps panes by default', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--live',
      '--confirm-herdr-side-effects',
    ])
    expect(result.status).toBe(0)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"herdr_live"')
    expect(scores).toContain('"authorized": true')
    expect(scores).toContain('"current"')
    expect(scores).toContain('"split"')
    expect(scores).toContain('"run"')
    expect(scores).toContain('"pass"')
    expect(scores).toContain('"new-pane-42"')
    expect(scores).toContain('"created_panes"')
    expect(scores).not.toContain('"close"')
    expect(result.stdout).toContain('Herdr live plan')
    expect(result.stdout).toContain('Expected model: gpt-5.6-terra')
    expect(result.stdout).toContain('Cleanup policy: keep')
  })

  it('--cleanup-created-panes closes panes after live herdr', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--live',
      '--confirm-herdr-side-effects',
      '--cleanup-created-panes',
    ])
    expect(result.status).toBe(0)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"close"')
    expect(scores).toContain('"pass"')
    expect(scores).toContain('"new-pane-42"')
    expect(result.stdout).toContain('Cleanup policy: close')
  })

  it('reports split failure and does not lose created pane ids', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFake(
      directory,
      'herdr',
      'case "$1 $2" in "pane current") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"current\\"}}}" ;; "pane split") echo split failure >&2; exit 4 ;; *) exit 0 ;; esac',
    )
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--live',
      '--confirm-herdr-side-effects',
    ])
    expect(result.status).toBe(1)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"current"')
    expect(scores).toContain('"pass"')
    expect(scores).toContain('"split"')
    expect(scores).toContain('"fail"')
    expect(scores).not.toContain('"run"')
    expect(scores).toContain('exit 4')
  })

  it('reports run failure on valid split and tracks failed pane', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFake(
      directory,
      'herdr',
      'case "$1 $2" in "pane current") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"current\\"}}}" ;; "pane split") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"new-pane-42\\"}}}" ;; "pane run") echo run failure >&2; exit 3 ;; *) exit 0 ;; esac',
    )
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--live',
      '--confirm-herdr-side-effects',
    ])
    expect(result.status).toBe(1)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"split"')
    expect(scores).toContain('"pass"')
    expect(scores).toContain('"run"')
    expect(scores).toContain('"fail"')
    expect(scores).toContain('"created_panes": [')
    expect(scores).toContain('"new-pane-42"')
    expect(scores).toContain('exit 3')
  })

  it('records cleanup failure and keeps pane ids in report', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFake(
      directory,
      'herdr',
      'case "$1 $2" in "pane current") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"current\\"}}}" ;; "pane split") echo "{\\"result\\":{\\"pane\\":{\\"pane_id\\":\\"new-pane-42\\"}}}" ;; "pane run") exit 0 ;; "pane close") echo close failure >&2; exit 5 ;; *) exit 1 ;; esac',
    )
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--live',
      '--confirm-herdr-side-effects',
      '--cleanup-created-panes',
    ])
    expect(result.status).toBe(1)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"close"')
    expect(scores).toContain('"fail"')
    expect(scores).toContain('exit 5')
    expect(scores).toContain('"new-pane-42"')
    expect(result.stdout).toContain('Failed to close pane')
  })

  it('reports current pane detection failure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFake(
      directory,
      'herdr',
      'case "$1 $2" in "pane current") echo not a pane >&2; exit 2 ;; *) exit 0 ;; esac',
    )
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, [
      '--attestation',
      attestation,
      '--live',
      '--confirm-herdr-side-effects',
    ])
    expect(result.status).toBe(1)
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"current"')
    expect(scores).toContain('"fail"')
    expect(scores).toContain('exit 2')
    expect(scores).not.toContain('"split"')
  })

  it('live herdr manifest includes authorization flags', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    expect(
      runExtended(directory, reportDir, [
        '--attestation',
        attestation,
        '--live',
        '--confirm-herdr-side-effects',
      ]).status,
    ).toBe(0)
    const manifest = readFileSync(join(reportDir, 'manifest.yaml'), 'utf8')
    expect(manifest).toContain('live_authorization')
    expect(manifest).toContain('live_flag: true')
    expect(manifest).toContain('side_effect_confirmation: true')
    expect(manifest).toContain('herdr_plan')
    expect(manifest).toContain('herdr_created_panes')
    expect(manifest).toContain('new-pane-42')
  })

  it('default extended smoke manifest includes live_authorization with false flags', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    expect(runExtended(directory, reportDir, ['--attestation', attestation]).status).toBe(0)
    const manifest = readFileSync(join(reportDir, 'manifest.yaml'), 'utf8')
    expect(manifest).toContain('live_flag: false')
    expect(manifest).toContain('side_effect_confirmation: false')
  })

  it('report.md contains herdr live step details when live is authorized', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    expect(
      runExtended(directory, reportDir, [
        '--attestation',
        attestation,
        '--live',
        '--confirm-herdr-side-effects',
      ]).status,
    ).toBe(0)
    const report = readFileSync(join(reportDir, 'report.md'), 'utf8')
    expect(report).toContain('- Herdr live: **executed**')
    expect(report).toContain('current (pass)')
    expect(report).toContain('split (pass)')
    expect(report).toContain('run (pass)')
    expect(report).toContain('id=new-pane-42')
    expect(report).toContain('Created panes: new-pane-42')
  })

  it('report.md shows not requested when no live flags', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const attestation = join(directory, 'attestation.yaml')
    writeFileSync(
      attestation,
      'manual_attestation:\n  method: herdr-pane\n  verified_by: u7chan\n  verified_at: 2026-07-11T00:00:00+09:00\n  expected_model: gpt-5.6-terra\n  observed_cli_model: gpt-5.6-terra\n  status: pass\n',
    )
    const reportDir = join(directory, 'report')
    expect(runExtended(directory, reportDir, ['--attestation', attestation]).status).toBe(0)
    const report = readFileSync(join(reportDir, 'report.md'), 'utf8')
    expect(report).toContain('- Herdr live: **not requested**')
    expect(report).not.toContain('current')
  })

  it('report.md shows not authorized with diagnostic on single flag', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFakeHerdrPassing(directory)
    const reportDir = join(directory, 'report')
    const result = runExtended(directory, reportDir, ['--live'])
    expect(result.status).toBe(1)
    const report = readFileSync(join(reportDir, 'report.md'), 'utf8')
    expect(report).toContain('**not authorized**')
  })

  it('does not affect core smoke (core does not call herdr)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-fake-cli-'))
    writeFakeBun(directory)
    writeFake(directory, 'codex', 'echo codex 1.0')
    writeFake(directory, 'opencode', 'echo opencode-go/deepseek-v4-pro')
    writeFake(directory, 'herdr', 'echo SHOULD NOT BE CALLED >&2; exit 99')
    const reportDir = join(directory, 'core-report')
    const result = spawnSync(
      process.execPath,
      ['validation/runner.ts', 'smoke', '--profile', 'core', '--report-dir', reportDir],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
        },
      },
    )
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('SHOULD NOT BE CALLED')
    const scores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
    expect(scores).toContain('"routing"')
    expect(scores).not.toContain('herdr')
  })
})

describe('candidate evaluation with a fake CLI', () => {
  function writeEvaluationFake(directory: string): string {
    const path = join(directory, 'fake-evaluate')
    writeFileSync(
      path,
      `#!/bin/sh
case "$FAKE_MODE" in
  fail) exit 8 ;;
  retry) if [ ! -f "$FAKE_STATE" ]; then touch "$FAKE_STATE"; echo 429 >&2; exit 1; fi ;;
  inconclusive) echo 503 >&2; exit 1 ;;
  timeout) sleep 1 ;;
  critical) echo CRITICAL_VIOLATION; exit 0 ;;
esac
[ -f "$4" ] || exit 9
[ -n "$FAKE_LOG" ] && printf '%s|%s\n' "$PWD" "$4" >> "$FAKE_LOG"
case "$4" in
  *low*) echo 'ANSWER: low' ;;
  *mid*) echo 'ANSWER: mid' ;;
  *high*) echo 'ANSWER: high' ;;
esac
`,
    )
    chmodSync(path, 0o755)
    return path
  }

  function runEvaluate(directory: string, reportDir: string, mode: string) {
    return spawnSync(
      process.execPath,
      [
        'validation/runner.ts',
        'evaluate',
        '--candidate',
        'fake/candidate',
        '--execute',
        '--confirm-live',
        '--report-dir',
        reportDir,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          CAGENT_EVALUATE_COMMAND: writeEvaluationFake(directory),
          FAKE_MODE: mode,
          FAKE_STATE: join(directory, 'retry-state'),
          FAKE_LOG: join(directory, 'invocations.log'),
        },
      },
    )
  }

  it('shows a plan without calling a model until explicitly confirmed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-evaluate-'))
    const reportDir = join(directory, 'report')
    const result = spawnSync(
      process.execPath,
      [
        'validation/runner.ts',
        'evaluate',
        '--candidate',
        'fake/candidate',
        '--report-dir',
        reportDir,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Planned model calls: 18')
    expect(readFileSync(join(reportDir, 'scores.json'), 'utf8')).toContain('not_run')
  })

  it('records passing, failed, retried, inconclusive, and critical results deterministically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-evaluate-'))
    const passReport = join(directory, 'pass')
    expect(runEvaluate(directory, passReport, 'pass').status).toBe(0)
    expect(readFileSync(join(passReport, 'scores.json'), 'utf8')).toContain('"status": "pass"')
    expect(runEvaluate(directory, join(directory, 'failed'), 'fail').status).toBe(1)
    const retryReport = join(directory, 'retry')
    expect(runEvaluate(directory, retryReport, 'retry').status).toBe(0)
    expect(readFileSync(join(retryReport, 'scores.json'), 'utf8')).toContain('"retried": true')
    expect(readFileSync(join(retryReport, 'manifest.yaml'), 'utf8')).toContain('executed_calls: 19')
    expect(runEvaluate(directory, join(directory, 'inconclusive'), 'inconclusive').status).toBe(1)
    const criticalReport = join(directory, 'critical')
    expect(runEvaluate(directory, criticalReport, 'critical').status).toBe(1)
    expect(readFileSync(join(criticalReport, 'scores.json'), 'utf8')).toContain(
      'CRITICAL_VIOLATION',
    )
  }, 10_000)

  it('normalizes a real spawnSync timeout and cleans up the copied-fixture workspace', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-evaluate-'))
    const fixture = join(process.cwd(), 'validation', 'evaluate', 'cases', 'low-summary.md')
    const log = join(directory, 'invocations.log')
    const previousMode = process.env.FAKE_MODE
    const previousLog = process.env.FAKE_LOG
    const previousCommand = process.env.CAGENT_EVALUATE_COMMAND
    process.env.FAKE_MODE = 'timeout'
    process.env.FAKE_LOG = log
    process.env.CAGENT_EVALUATE_COMMAND = writeEvaluationFake(directory)
    try {
      expect(
        evaluateInvocation(writeEvaluationFake(directory), 'candidate', fixture, 20).status,
      ).toBe(124)
      const reportDir = join(directory, 'timeout-report')
      expect(
        evaluate(
          [
            '--candidate',
            'fake/candidate',
            '--execute',
            '--confirm-live',
            '--report-dir',
            reportDir,
          ],
          {
            baseline: 'fake/baseline',
            trials: 1,
            timeout_ms: 20,
            cases: [
              {
                id: 'low-summary',
                level: 'low',
                fixture: 'evaluate/cases/low-summary.md',
                rubric: { required: ['ANSWER: low'], forbidden: [] },
              },
            ],
            hidden_checks: { forbidden: [] },
          },
        ),
      ).toBe(1)
      const timeoutScores = readFileSync(join(reportDir, 'scores.json'), 'utf8')
      expect(timeoutScores).toContain('"status": "inconclusive"')
      expect(timeoutScores).toContain('"retried": true')
      expect(readFileSync(join(reportDir, 'manifest.yaml'), 'utf8')).toContain('executed_calls: 4')
      process.env.FAKE_MODE = 'pass'
      expect(
        evaluateInvocation(writeEvaluationFake(directory), 'candidate', fixture, 20).status,
      ).toBe(0)
      const [workspace, copiedFixture] = readFileSync(log, 'utf8').trim().split('|')
      expect(workspace.startsWith(join(tmpdir(), 'cagent-evaluate-'))).toBe(true)
      expect(copiedFixture.startsWith(workspace)).toBe(true)
      expect(existsSync(workspace)).toBe(false)
    } finally {
      if (previousMode === undefined) delete process.env.FAKE_MODE
      else process.env.FAKE_MODE = previousMode
      if (previousLog === undefined) delete process.env.FAKE_LOG
      else process.env.FAKE_LOG = previousLog
      if (previousCommand === undefined) delete process.env.CAGENT_EVALUATE_COMMAND
      else process.env.CAGENT_EVALUATE_COMMAND = previousCommand
    }
  })

  it('only emits the standardized artifacts in an evaluation report directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-evaluate-'))
    const reportDir = join(directory, 'report')
    expect(runEvaluate(directory, reportDir, 'pass').status).toBe(0)
    expect(
      ['manifest.yaml', 'report.md', 'scores.json'].every((name) => {
        try {
          return readFileSync(join(reportDir, name), 'utf8').length > 0
        } catch {
          return false
        }
      }),
    ).toBe(true)
  })

  it('records the evaluation configuration hash in evaluation manifests', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cagent-evaluate-'))
    const reportDir = join(directory, 'report')
    expect(runEvaluate(directory, reportDir, 'pass').status).toBe(0)
    expect(readFileSync(join(reportDir, 'manifest.yaml'), 'utf8')).toContain(
      'evaluation_config_sha256:',
    )
  })
})
