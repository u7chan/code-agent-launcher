# ローカル検証

Codex と OpenCode のモデルルーティングスモークを実行します。`--profile core` は既定で両方のエージェントを検証します。

```bash
# テストビルドとモデル解決だけを確認する（Codex + OpenCode）
bun run validate smoke --profile core

# 特定のエージェントだけを検証する
bun run validate smoke --profile core --agent codex
bun run validate smoke --profile core --agent opencode-go

# 実CLIを起動する（外部モデル呼び出しあり）
bun run validate smoke --profile core --live
```

## モデルマッピング

| Agent | Level | Expected model |
| --- | --- | --- |
| codex | low | gpt-5.6-luna |
| codex | mid | gpt-5.6-terra |
| codex | high | gpt-5.6-sol |
| opencode-go | low | opencode-go/deepseek-v4-flash |
| opencode-go | mid | opencode-go/deepseek-v4-pro |
| opencode-go | high | opencode-go/kimi-k2.7-code |

レポートは既定で `validation/.artifacts/` に生成され、Git管理されません。

プロバイダー応答が示す実モデルIDは取得しません。レポートでは `backend_attestation: unobservable` として明示します。

## Herdr extended smoke

`extended` は doctor、models、Herdr 経由の起動を検証します。実 Herdr pane を確認した後、確認者が attestation YAML を作成して渡してください。これは実 CLI に渡されたモデルの人手確認であり、provider 側の実モデルIDを検証するものではありません。

```bash
bun run validate smoke --profile extended --attestation /absolute/path/to/attestation.yaml
```

```yaml
manual_attestation:
  method: herdr-pane
  verified_by: <GitHubユーザー名>
  verified_at: 2026-07-11T00:00:00+09:00
  expected_model: gpt-5.6-terra
  observed_cli_model: gpt-5.6-terra
  status: pass
```

`method`、確認者、時刻、モデル、`status: pass` は必須です。expected/observed model は対象の routing と一致する必要があります。attestation がない・不正・Herdr 未導入・Herdr 起動失敗の場合もレポートを残して失敗します。生成物、スクリーンショット、生ログは Git 管理しません。

extended の `scores.json` は `automatic_routing`、`manual_attestation`、`backend_attestation` を別フィールドで記録します。

## 候補モデルの最小品質評価

routing smoke とは別に、low / mid / high の固定fixtureを用いる候補モデル評価を実行できます。通常実行は予定表示と定型成果物の生成だけで、モデルは呼び出しません。

```bash
bun run validate evaluate --candidate codex/gpt-5.6-sol
```

表示される候補・baseline・ケース・各3試行・予定呼び出し数を確認したうえで、外部CLIを明示的に指定し、実行を二重に承認してください。

```bash
CAGENT_EVALUATE_COMMAND=/absolute/path/to/evaluator \
  bun run validate evaluate --candidate codex/gpt-5.6-sol --execute --confirm-live
```

評価CLIは `--model <model> --case <fixture>` を受け取り、標準出力へ回答を返します。candidate と baseline を各ケース・試行ごとに交互実行します。各ケースで candidate が 3 回中 2 回以上成功し、重大違反が 0 件なら pass です。timeout、429、5xx、通信断は1回だけ再試行し、継続した場合は `inconclusive` とします。

生成される `report.md`、`manifest.yaml`、`scores.json` と `validation/.artifacts/index.md` はすべて `validation/.artifacts/` 配下です。生ログ、モデル出力、一時workspaceは保存・Git管理しません。
