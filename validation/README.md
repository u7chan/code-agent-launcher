# ローカル検証

Codex向けのモデルルーティングスモークを実行します。

```bash
# テストビルドとモデル解決だけを確認する
bun run validate smoke --profile core

# Codex CLIを実際に起動する
bun run validate smoke --profile core --live
```

`low` / `mid` / `high` はそれぞれ `gpt-5.6-luna`、`gpt-5.6-terra`、`gpt-5.6-sol` へ固定されています。レポートは既定で `validation/.artifacts/` に生成され、Git管理されません。

プロバイダー応答が示す実モデルIDは、このCodex初期実装では取得しません。レポートでは `backend_attestation: unobservable` として明示します。
