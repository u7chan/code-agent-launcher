# 開発ガイド

## 概要

このリポジトリは、コーディングエージェント用ランチャー `code-agent-launcher` です。CLI コマンドは `cagent` です。

## TechStack

- TypeScript / Node.js 18+
- Bun（テスト・開発実行）
- Commander（CLI）
- YAML（設定ファイルの読み込み）
- Biome（Lint・フォーマット）

## Commands

依存関係をインストールした後、以下のコマンドを使用します。

```bash
bun install
bun run dev          # ソースから開発実行
bun run build        # dist/ へビルド
bun test src/        # テスト
bun run lint         # Lint・型チェック
bun run format:check # フォーマット確認
bun run check        # Biomeチェック・型チェック
```

## Related files

- `src/index.ts`: CLIエントリーポイント
- `src/command.ts`: CLIコマンドの定義
- `src/run.ts`: 非対話実行
- `src/mux/`: Herdrなどのマルチプレクサ連携
- `src/agents/`: エージェントごとの実行処理
- `src/config.ts`: 設定ファイルと環境変数の処理
- `src/doctor.ts`: 設定・環境の検証
- `skills/coding-agent-subagent/SKILL.md`: サブエージェント呼び出しの詳細ルール
- `.github/workflows/ci.yml`: CI設定
