# ローカル検証

CodexとOpenCode Goのモデルルーティングスモークを実行します。ここで指定する
`--profile core` / `--profile extended` はvalidation runnerの実行モードです。cagentの
Launch Profileとは別に、検証の範囲を表します。

```bash
# buildとLaunch Profileごとのmodel解決だけを確認する（外部CLI起動なし）
bun run validate smoke --profile core

# 特定のagentだけを検証する
bun run validate smoke --profile core --agent codex
bun run validate smoke --profile core --agent opencode-go

# 実CLIを起動する（外部モデル呼び出しあり）
bun run validate smoke --profile core --live
```

## Launch Profileとmodelの対応

ルーティングmatrixは `validation/config/matrix.yaml` で管理します。Profile名は任意の
文字列ですが、検証用設定ではagentごとに次の名前を使います。

| Agent | Launch Profile | Expected model |
| --- | --- | --- |
| codex | codex-fast | gpt-5.6-luna |
| codex | codex-balanced | gpt-5.6-terra |
| codex | codex-frontier | gpt-5.6-sol |
| opencode-go | opencode-fast | opencode-go/deepseek-v4-flash |
| opencode-go | opencode-balanced | opencode-go/deepseek-v4-pro |
| opencode-go | opencode-frontier | opencode-go/kimi-k2.7-code |

レポートは既定で `validation/.artifacts/` に生成され、Git管理されません。プロバイダー
応答が示す実モデルIDは取得しないため、レポートでは
`backend_attestation: unobservable` として明示します。

## Herdr extended smoke

`extended` はdoctor、models、mux dry-run、attestation検証を非破壊で実行します。既定では
実Herdrを起動せず、`herdr pane split/run`を呼びません。既定の対象は
`codex:codex-balanced`です。

```bash
# 既定：dry-run、doctor、models、attestation検証のみ（実Herdr起動なし）
bun run validate smoke --profile extended --attestation /absolute/path/to/attestation.yaml

# 対象agentとLaunch Profileを明示
bun run validate smoke --profile extended \
  --agent opencode-go --target opencode-balanced \
  --attestation /absolute/path/to/attestation.yaml
```

実Herdrの起動には、`--live`と`--confirm-herdr-side-effects`の両方が必須です。片方だけ
では起動せず、失敗理由をレポートします。

```bash
# 実Herdr起動（二重承認あり）
bun run validate smoke --profile extended \
  --attestation /absolute/path/to/attestation.yaml \
  --live --confirm-herdr-side-effects
```

attestationの例:

```yaml
manual_attestation:
  method: herdr-pane
  verified_by: <GitHubユーザー名>
  verified_at: 2026-07-11T00:00:00+09:00
  expected_model: gpt-5.6-terra
  observed_cli_model: gpt-5.6-terra
  status: pass
```

### 実Herdr起動の流れ

`--live --confirm-herdr-side-effects`を指定すると、以下の流れで実行します。

1. 実行前に予定pane数、agent、Launch Profile、expected model、コマンド概要、保持/cleanup方針を表示
2. `herdr pane current`で現在paneを検出
3. `herdr pane split`で新paneを作成（作成直後からpane IDを追跡）
4. `herdr pane run`でコマンドを実行
5. 既定ではpaneを**保持**。`--cleanup-created-panes`指定時のみ今回作成したpaneをclose

split/run/closeの各ステップの成否、JSONパースエラー、事前チェック失敗は
`scores.json`の`herdr_live.steps`に構造化して記録されます。cleanupに失敗したpaneはIDを
保持してfail報告し、無断でcloseしません。

`method`、確認者、時刻、model、`status: pass`は必須です。expected/observed modelは対象の
routingと一致する必要があります。attestationがない・不正な場合もレポートを残して失敗
します。生成物、スクリーンショット、生ログはGit管理しません。

extendedの`scores.json`は`automatic_routing`、`manual_attestation`、`herdr_live`
（live時のみ）、`backend_attestation`を別フィールドで記録します。

## 候補modelの最小品質評価

routing smokeとは別に、候補model評価用の3つの固定fixtureを実行できます。通常実行は
予定表示と定型成果物の生成だけで、modelは呼び出しません。

```bash
bun run validate evaluate --candidate codex/gpt-5.6-sol
```

表示される候補・baseline・fixture・各3試行・予定呼び出し数を確認したうえで、外部CLIを
明示的に指定し、実行を二重に承認してください。

```bash
CAGENT_EVALUATE_COMMAND=/absolute/path/to/evaluator \
  bun run validate evaluate --candidate codex/gpt-5.6-sol --execute --confirm-live
```

評価CLIは `--model <model> --case <fixture>` を受け取り、標準出力へ回答を返します。
candidateとbaselineを各fixture・試行ごとに交互実行します。各fixtureでcandidateが3回中
2回以上成功し、重大違反が0件ならpassです。timeout、429、5xx、通信断は1回だけ再試行し、
継続した場合は`inconclusive`とします。

生成される`report.md`、`manifest.yaml`、`scores.json`と`validation/.artifacts/index.md`は
すべて`validation/.artifacts/`配下です。生ログ、model出力、一時workspaceは保存・Git管理
しません。
