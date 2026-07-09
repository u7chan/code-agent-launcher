---
name: opencodego-subagent
description: OpenCode Go をサブエージェントとして呼び出すときに使う。`ocgo` ラッパー経由でモデルレベルとマルチプレクサ起動を統一する。
---

# opencodego-subagent

## いつ使うか

- OpenCode Go モデルをサブエージェントとして 1 回だけ呼び出したいとき
- 安価な軽作業から重い設計レビューまで、タスクレベルに応じたモデルを選びたいとき
- Herdr 上に永続的な OpenCode セッションを残したいとき

## 基本ルール

- `opencode` を直接呼び出さない。原則 `ocgo` を使う。
- 1 回きりの非対話実行では `ocgo run <level> -- "<prompt>"` を使う。
- Herdr 上に永続セッションを立てる場合は `ocgo mux start <level>` を使う。
- Herdr 上で 1 回きりを投げる場合は `ocgo mux run <level> -- "<prompt>"` を使う。
- ユーザーがモデルを明示していれば `--model <model>` を付ける。
- タスクレベルは以下を目安に選ぶ。
  - `low`: typo 修正、README 整形、小さな文言修正、単純な調査、反復的な雑務
  - `mid`: 1〜数ファイルの実装、既存設計に沿った追加、バグ修正、テスト追加、軽めのリファクタ、通常の調査
  - `high`: アーキテクチャ検討、認証/DB/CI 設計、大きめの影響範囲調査、破壊的変更前レビュー、複雑な不具合調査、失敗コストが高い判断
- `tmux` は前提にしない。設定されている multiplexer は Herdr を想定する。
- OpenCode TUI を Codex / Claude Code / 他の CLI エージェントの子プロセスとして直接起動しない。

## 使用例

```bash
# 軽作業
ocgo run low -- "READMEの表記ゆれを直して"

# 通常実装
ocgo run mid -- "このIssueの実装方針を作り、必要な変更点を列挙して"

# 重い設計レビュー
ocgo run high -- "この認証設計のリスクと代替案をレビューして"

# 明示モデル
ocgo run --model qwen3.7-max -- "DBマイグレーション計画をレビューして"

# Herdr 経由で永続セッションを立てる
ocgo mux start high

# Herdr 経由で 1 回実行
ocgo mux run mid -- "このIssueを調査して"
```
