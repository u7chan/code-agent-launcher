# Agent 向けガイドライン

このリポジトリは汎用コーディングエージェントランチャー `code-agent-launcher` です。CLI コマンドは `cagent` です。

## サブエージェントとして OpenCode Go を使う場合

- `opencode` 本体を直接呼び出さず、原則 `cagent --agent opencode-go` を経由して呼び出してください。
- 1 回きりの非対話実行では `cagent run --agent opencode-go <level> -- "<prompt>"` を基本形として使ってください。
- Herdr 上に永続的なセッションを立てる場合は `cagent mux start --agent opencode-go <level>` を使ってください。
- Herdr 上で 1 回きり実行する場合は `cagent mux run --agent opencode-go <level> -- "<prompt>"` を使ってください。
- タスクレベルは `low` / `mid` / `high` のいずれかを選び、作業の重さに応じて判断してください。
- `tmux` は前提とせず、multiplexer は Herdr を想定してください。
- OpenCode TUI を Codex / Claude Code / 他の CLI エージェントの子プロセスとして直接起動しないでください。

## 関連ファイル

- `skills/coding-agent-subagent/SKILL.md`: コーディングエージェントのサブエージェント呼び出しの詳細ルール
