# ocgo

OpenCode Go ラッパー CLI。タスクレベルに応じたモデル選択と、Herdr などのマルチプレクサ経由での起動を統一します。

## 主な機能

- `low` / `mid` / `high` のタスクレベルに応じてデフォルトモデルを解決
- ユーザーが `--model` を明示した場合はそれを最優先
- 非対話実行用の `run` コマンド
- Herdr 連携用の `mux` コマンド
- 設定と環境の検証用 `doctor` コマンド

## 主なコマンド例

```bash
# 非対話実行
ocgo run low -- "READMEの表記ゆれを直して"
ocgo run mid -- "このIssueの実装方針を作り、必要な変更点を列挙して"
ocgo run high -- "この認証設計のリスクと代替案をレビューして"

# 明示モデル指定
ocgo run --model qwen3.7-max -- "DBマイグレーション計画をレビューして"

# Herdr 経由で永続セッションを立てる
ocgo mux start high

# Herdr 経由で 1 回実行
ocgo mux run mid -- "このIssueを調査して"

# 設定と環境の検証
ocgo doctor
```

## エージェント向けルール

サブエージェントとして OpenCode Go を使う場合は、原則 `ocgo` 経由で呼び出してください。詳細は `AGENTS.md` と `skills/opencodego-subagent/SKILL.md` を参照してください。
