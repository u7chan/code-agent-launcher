---
name: validation-log-update
description: >
  code-agent-launcher の smoke / evaluate 検証完了後に、wiki 上の Validation-Log.md へ結果を追記する。
  「Wiki更新」「Validation Logに追記」「検証結果をwikiに」などで起動。
---

# 検証ログを Wiki へ追記する

## 概要

`bun run validate smoke` または `bun run validate evaluate` の実行後、生成されたレポートを
GitHub Wiki の `Validation-Log.md` に追記する。

## このスキルを使用するタイミング

- バリデーション完了後、結果を Wiki へ残すよう依頼されたとき
- 「Wiki更新」「Validation Logに追記」「検証結果をwikiに」と言われたとき

## Agentが行うこと

1. 最新の `.artifacts/<runId>/` から `report.md` と `manifest.yaml` を読み取る
2. Wiki リポジトリを clone または fetch する
3. 既存 `Validation-Log.md` の先頭（`# Validation Log` の直後）に新規エントリを挿入する
4. commit + push する

## ステップの詳細

### 1. レポートの読み取り

最新の `.artifacts/` ディレクトリを特定する。指定がない場合は `ls -t validation/.artifacts/ | head -n 1` で最新を取得。

`manifest.yaml` から以下を抽出:
- `profile` — core / extended
- `mode` — routing-only / live

`report.md` から以下を抽出:
- `Tested commit`
- 結果テーブル（Agent, Level, Expected model, Routing, Live run の列）

### 2. Wiki リポジトリの準備

```bash
WIKI_DIR=$(mktemp -d)
git clone git@github.com:u7chan/code-agent-launcher.wiki.git "$WIKI_DIR"
```

clone に失敗した場合は、Wiki が未初期化のため、ユーザーに以下を依頼する:
`https://github.com/u7chan/code-agent-launcher/wiki` で最初のページを作成するよう伝える。

### 3. エントリの生成と挿入

`Validation-Log.md` がない場合は新規作成。ある場合は `# Validation Log` 見出しの直後に挿入。

エントリ形式（smoke / core）:

```markdown
## YYYY-MM-DD: {Agent名} Smoke Core (`--live` または dry-run)

- **関連**: {Issue/PR番号とリンク}
- **コミット**: `{short hash}`
- **プロファイル**: {profile}
- **モード**: {mode}
- **アーティファクト**: `validation/.artifacts/{runId}/`

| Agent | Level | Expected Model | Dry-run | Live |
|---|---|---|---|---|
| {agent} | low | {model} | pass | pass |
| {agent} | mid | {model} | pass | pass |
| {agent} | high | {model} | pass | pass |
```

evaluate の場合は report.md の内容に応じてテーブル列を調整する。

### 4. commit + push

```bash
cd "$WIKI_DIR"
git add Validation-Log.md
git commit -m "validation-log: {日付} {プロファイル} {モード}"
git push origin master
```

## 品質チェック

- [ ] 最新の `.artifacts/` ディレクトリを正しく特定しているか
- [ ] `manifest.yaml` と `report.md` の両方から情報を抽出しているか
- [ ] エントリが `# Validation Log` の直後に時系列降順で挿入されているか
- [ ] テーブルの列が report.md の列と一致しているか
- [ ] 空のコミットをしていないか（変更がある場合のみ commit）
- [ ] push が成功しているか

## 参考資料

- `validation/.artifacts/` — 検証レポートの出力先
- Wiki リポジトリ: `git@github.com:u7chan/code-agent-launcher.wiki.git`
