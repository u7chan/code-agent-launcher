---
name: coding-agent-subagent
description: コーディングエージェントをサブエージェントとして呼び出すときに使う。`cagent` 経由でエージェント選択、モデルレベル、マルチプレクサ起動を統一する。
---

# coding-agent-subagent

## いつ使うか

- Codex や OpenCode Go など、設定済みのコーディングエージェントをサブエージェントとして呼び出したいとき
- 安価な軽作業から重い設計レビューまで、タスクレベルに応じたモデルを選びたいとき
- Herdr 上に永続的なコーディングエージェントセッションを残したいとき

## 基本ルール

- 利用するエージェントは、設定済みのIDを `--agent <agent>` で明示して選ぶ。未指定時は設定の `default_agent` が使われる。
- 1 回きりの非対話実行では `cagent run --agent <agent> <level> -- "<prompt>"` を使う。
- Herdr 上に永続セッションを立てる場合は `cagent mux start --agent <agent> <level>` を使う。
- Herdr 上で 1 回きりを投げる場合は `cagent mux run --agent <agent> <level> -- "<prompt>"` を使う。
- ユーザーがモデルを明示していれば `--model <model>` を付ける。
- タスクレベルは以下を目安に選ぶ。
  - `low`: typo 修正、README 整形、小さな文言修正、単純な調査、反復的な雑務
  - `mid`: 1〜数ファイルの実装、既存設計に沿った追加、バグ修正、テスト追加、軽めのリファクタ、通常の調査
  - `high`: アーキテクチャ検討、認証/DB/CI 設計、大きめの影響範囲調査、破壊的変更前レビュー、複雑な不具合調査、失敗コストが高い判断
- `tmux` は前提にしない。設定されている multiplexer は Herdr を想定する。
- 対話型のエージェントを別のCLIエージェントの子プロセスとして直接起動しない。必要な場合は `cagent mux start` を使う。

## エージェント別の注意

- OpenCode Go を使う場合は `opencode` を直接呼び出さず、`--agent opencode-go` を指定して `cagent` 経由で起動する。
- Codex を使う場合は、設定に `codex` エージェントを定義してから `--agent codex` を指定する。

## 使用例

```bash
# OpenCode Go による軽作業
cagent run --agent opencode-go low -- "READMEの表記ゆれを直して"

# Codex による通常実装（設定済みの場合）
cagent run --agent codex mid -- "このIssueの実装方針を作り、必要な変更点を列挙して"

# OpenCode Go による重い設計レビュー
cagent run --agent opencode-go high -- "この認証設計のリスクと代替案をレビューして"

# 明示モデル
cagent run --agent opencode-go --model qwen3.7-max -- "DBマイグレーション計画をレビューして"

# Herdr 経由で永続セッションを立てる
cagent mux start --agent opencode-go high

# Herdr 経由で 1 回実行
cagent mux run --agent opencode-go mid -- "このIssueを調査して"
```
