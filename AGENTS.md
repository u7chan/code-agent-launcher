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
bun run validate smoke --profile core # Codexモデルルーティング検証
```

`bun run validate smoke --profile core --live` は Codex CLI を3回起動します。外部モデル呼び出しとなるため、明示的な依頼または確認がある場合にだけ実行してください。詳細は [validation/README.md](validation/README.md) を参照してください。

## Skills

「リリースして」「Version更新PRを作って」「Releaseを開始して」「release tagを作って」など、
maintainer向けRelease作業の依頼では `skills/github-release/SKILL.md` を使用してください。
Version更新PRを作る `prepare` と、merge済みmainを検証してtag pushを開始する `start` を分離し、
Skillの承認ゲートと禁止事項に従ってください。

## Related files

- `src/index.ts`: CLIエントリーポイント
- `src/command.ts`: CLIコマンドの定義
- `src/run.ts`: 非対話実行
- `src/mux/`: Herdrなどのマルチプレクサ連携
- `src/agents/`: エージェントごとの実行処理
- `src/config.ts`: 設定ファイルと環境変数の処理
- `src/doctor.ts`: 設定・環境の検証
- `validation/README.md`: Codexモデルルーティングの精度検証手順
- `.claude/skills/validate-code-agent-launcher/SKILL.md`: 検証を実行・報告するエージェント向け手順
- `skills/github-release/SKILL.md`: maintainer向けReleaseのprepare/start手順
- `.github/workflows/ci.yml`: CI設定
