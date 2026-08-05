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
bun run validate smoke --profile core # Launch Profileのモデルルーティング検証
```

`bun run validate smoke --profile core --live` は CodexとOpenCode Goの各3つのLaunch Profileを実行します。外部モデル呼び出しとなるため、明示的な依頼または確認がある場合にだけ実行してください。詳細は [validation/README.md](validation/README.md) を参照してください。

## Skills

「リリースして」「Version更新PRを作って」「Releaseを開始して」「release tagを作って」など、
maintainer向けRelease作業の依頼では `.agents/skills/github-release/SKILL.md` を使用してください。
Version更新PRを作る `prepare` と、merge済みmainを検証してtag pushを開始する `start` を分離し、
Skillの承認ゲートと禁止事項に従ってください。

## PRマージの禁止

エージェントはユーザーから明示的なマージ依頼がない限り、PRをマージしない。CI完了前にマージしない。

## モデル名のハードコード禁止

- プロダクトコード（`src/*.ts`、テストファイルを除く）に実際のモデル名をハードコードしない
- テストコード（`src/*.test.ts`）では架空のモデル名（`test-model-v1`, `example-model-fast` など）を使用する
- `validation/` は実際のモデルルーティング検証のため、本ルールの例外とする
- デフォルト設定テンプレート（`DEFAULT_CONFIG`）も架空名を使用する

## Related files

- `src/index.ts`: CLIエントリーポイント
- `src/command.ts`: CLIコマンドの定義
- `src/run.ts`: 非対話実行
- `src/mux/`: Herdrなどのマルチプレクサ連携
- `src/agents/`: エージェントごとの実行処理
- `src/config.ts`: 設定ファイルと環境変数の処理
- `src/doctor.ts`: 設定・環境の検証
- `validation/README.md`: Launch Profileのモデルルーティング検証手順
- `.agents/skills/validate-code-agent-launcher/SKILL.md`: 検証を実行・報告するエージェント向け手順
- `.agents/skills/github-release/SKILL.md`: maintainer向けReleaseのprepare/start手順
- `.github/workflows/ci.yml`: CI設定
