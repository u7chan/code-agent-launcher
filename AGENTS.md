# Agent 向けガイドライン

このリポジトリは `ocgo` という OpenCode Go ラッパー CLI です。

## サブエージェントとして OpenCode Go を使う場合

- `opencode` 本体を直接呼び出さず、原則 `ocgo` を経由して呼び出してください。
- 1 回きりの非対話実行では `ocgo run <level> -- "<prompt>"` を基本形として使ってください。
- Herdr 上に永続的なセッションを立てる場合は `ocgo mux start <level>` を使ってください。
- Herdr 上で 1 回きり実行する場合は `ocgo mux run <level> -- "<prompt>"` を使ってください。
- ユーザーがモデルを明示している場合は `--model <model>` を `ocgo run` / `ocgo mux run` / `ocgo mux start` に付けてください。
- タスクレベルは `low` / `mid` / `high` のいずれかを選び、作業の重さに応じて判断してください。
- `tmux` は前提とせず、multiplexer は Herdr を想定してください。
- OpenCode TUI を Codex / Claude Code / 他の CLI エージェントの子プロセスとして直接起動しないでください。

## 関連ファイル

- `skills/opencodego-subagent/SKILL.md`: OpenCode Go サブエージェント呼び出しの詳細ルール
