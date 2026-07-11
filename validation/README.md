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
| opencode-go | high | opencode-go/minimax-m3 |

レポートは既定で `validation/.artifacts/` に生成され、Git管理されません。

プロバイダー応答が示す実モデルIDは取得しません。レポートでは `backend_attestation: unobservable` として明示します。
