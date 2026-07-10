# code-agent-launcher

コーディングエージェント用ランチャー。CLI コマンドは `cagent` です。

## 主な機能

- `low` / `mid` / `high` のタスクレベルに応じてデフォルトモデルを解決
- ユーザーが `--model` を明示した場合はそれを最優先
- 非対話実行用の `run` コマンド
- Herdr 連携用の `mux` コマンド
- 設定と環境の検証用 `doctor` コマンド

## 主なコマンド例

```bash
# 非対話実行
cagent run low -- "READMEの表記ゆれを直して"
cagent run mid -- "このIssueの実装方針を作り、必要な変更点を列挙して"
cagent run high -- "この認証設計のリスクと代替案をレビューして"

# 明示モデル指定
cagent run --agent opencode-go --model qwen3.7-max -- "DBマイグレーション計画をレビューして"

# Herdr 経由で永続セッションを立てる
cagent mux start high

# Herdr 経由で 1 回実行
cagent mux run mid -- "このIssueを調査して"

# 設定と環境の検証
cagent doctor
```

## エージェント向けルール

設定ファイルは `~/.config/cagent/config.yaml` です。環境変数には `CAGENT_CONFIG` / `CAGENT_AGENT` / `CAGENT_MODEL` / `CAGENT_LEVEL` を使用します。
