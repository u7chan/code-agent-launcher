# Agent 向けガイドライン

このリポジトリは汎用コーディングエージェントランチャー `code-agent-launcher` です。CLI コマンドは `cagent` です。

## サブエージェントとしてコーディングエージェントを使う場合

- 設定済みのエージェントIDを `--agent <agent>` で明示し、原則 `cagent` を経由して呼び出してください。
- 1 回きりの非対話実行では `cagent run --agent <agent> <level> -- "<prompt>"` を基本形として使ってください。
- Herdr 上に永続的なセッションを立てる場合は `cagent mux start --agent <agent> <level>` を使ってください。
- Herdr 上で 1 回きり実行する場合は `cagent mux run --agent <agent> <level> -- "<prompt>"` を使ってください。
- タスクレベルは `low` / `mid` / `high` のいずれかを選び、作業の重さに応じて判断してください。
- `tmux` は前提とせず、multiplexer は Herdr を想定してください。
- 対話型エージェントを Codex / Claude Code / 他の CLI エージェントの子プロセスとして直接起動しないでください。

## 関連ファイル

- `skills/coding-agent-subagent/SKILL.md`: コーディングエージェントのサブエージェント呼び出しの詳細ルール
