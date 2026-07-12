---
name: validate-code-agent-launcher
description: Run the repository-local validation workflow for code-agent-launcher. Use when asked to validate cagent routing, build the local CLI, run the Codex or OpenCode smoke test, collect a validation report, or prepare a validation PR.
---

# Validate Code Agent Launcher

Run the deterministic validation runner. Do not reimplement its build, model-resolution, or report logic in prompts.

## Smoke

1. Inspect the worktree and explain existing changes before validation.
2. Run `bun run validate smoke --profile core` to build `dist/index.js` and verify routing for Codex and OpenCode.
3. Use `--agent codex` or `--agent opencode-go` to run only one agent.
4. Before an external model call, state that `--live` starts both Codex and OpenCode three times each (`low`, `mid`, `high`), or list the specific agent if `--agent` is used.
5. Run `bun run validate smoke --profile core --live` only after the user explicitly requests live validation or confirms the planned calls.
6. Report the generated directory below `validation/.artifacts/` and distinguish routing from backend attestation.

The routing matrix is fixed in `validation/config/matrix.yaml`:

| Agent | Level | Expected model |
| --- | --- | --- |
| codex | low | gpt-5.6-luna |
| codex | mid | gpt-5.6-terra |
| codex | high | gpt-5.6-sol |
| opencode-go | low | opencode-go/deepseek-v4-flash |
| opencode-go | mid | opencode-go/deepseek-v4-pro |
| opencode-go | high | opencode-go/kimi-k2.7-code |

Treat `backend_attestation: unobservable` as an unknown state, not a successful provider-side model verification.

## Candidate evaluation

`bun run validate evaluate --candidate <agent/model>` は候補・baseline・low/mid/high fixture・3試行・予定呼び出し数を表示し、モデルを起動しない。実評価はユーザーが明示承認した場合のみ、`--execute --confirm-live` と `CAGENT_EVALUATE_COMMAND` を指定して行う。予定は18呼び出し（3ケース × candidate/baseline × 3試行）であることを事前に伝える。

評価はケースごとにcandidate/baselineを交互実行し、candidateが各ケースで2/3成功、かつ重大違反ゼロの場合だけpassとする。timeout、429、5xx、通信断は1回再試行し、続けばinconclusiveとして扱う。`validation/.artifacts/` のreport、manifest、scores、index以外に生ログ・全出力・一時workspaceを保存またはコミットしない。

## Herdr extended smoke

`bun run validate smoke --profile extended --attestation <absolute-path>` は既定で dry-run、doctor、models、attestation 検証のみを実行し、実 Herdr を起動しません。実 Herdr pane の起動には `--live` と `--confirm-herdr-side-effects` の両方が必須です。片方だけでは一切 split/run/close を呼ばず、失敗理由をレポートします。

```bash
# 既定：実Herdr起動なし
bun run validate smoke --profile extended --attestation /absolute/path/to/attestation.yaml

# 実Herdr起動（二重承認あり）
bun run validate smoke --profile extended \
  --attestation /absolute/path/to/attestation.yaml \
  --live --confirm-herdr-side-effects
```

live 前には予定ペイン数、agent、level、expected model、コマンド概要、保持/cleanup方針を表示する。split 成功直後から作成 pane ID を追跡し、run 失敗でも ID を失わない。既定はペイン保持。`--cleanup-created-panes` 指定時のみ今回作成したペインを close し、cleanup 失敗時は ID を保持して fail 報告する。current/split/run/cleanup の各結果は `scores.json` の `herdr_live.steps` に構造化記録される。

レポートでは `automatic_routing`、`manual_attestation`、`backend_attestation` を混同せずに報告する。attestation、スクリーンショット、生ログ、`validation/.artifacts/` はコミットしない。

## Wiki

検証完了後、結果を永続化するには `validation-log-update` スキルを使う。GitHub Wiki の `Validation-Log.md` にエントリを追記する。

## Validation PRs

When asked for a validation PR, require a clean worktree before the formal run. Commit the tested change first, run validation, then commit the report separately. Do not commit files below `validation/.artifacts/`.
