---
name: github-submit-change
description: code-agent-launcher向けのGitブランチ、英語Prefix付きcommit、GitHub PRを作成する。ブランチ命名、変更・PR指摘対応のcommit、PR作成を依頼されたときに使用する。
---

# GitHub 変更提出

ユーザーが依頼したGit操作だけを行い、以下の規約を適用する。

## ブランチ名

Issueがない場合は`<type>/<description>`、Issueがある場合は`<type>/issue-<number>-<description>`を使用する。

- Typeは`feature`、`fix`、`docs`、`refactor`、`test`、`chore`から選ぶ。
- 小文字のkebab-caseで書く。
- Descriptionは短く具体的にする。

例: `feature/add-model-filter`、`fix/issue-123-config-loading`。

## コミットメッセージ

英語で`<prefix>: <summary>`と書く。

- `feat`: 新しい動作
- `fix`: バグ修正
- `docs`: ドキュメントのみ
- `refactor`: 動作を変えないコード変更
- `test`: テストのみ
- `chore`: 保守作業
- `build`: ビルドまたは依存関係の変更
- `ci`: CIの変更
- `fb`: PRレビュー指摘への対応

PRレビュー指摘だけに対応するcommitでは、変更種別のPrefixより`fb`を優先する。Summaryは英語の命令形かつ小文字で始め、末尾にピリオドを付けない。例: `feat: add model filtering`、`fb: handle an empty model list`。

## PR本文

次のテンプレートを使用し、該当しないセクションは削除する。PRがIssueを完全に解決する場合だけ`Closes #123`を使用し、それ以外は`Refs #123`を使用する。

```markdown
## Issues

- Closes #123

## Why

変更が必要な理由を書く。

## Summary

変更後の動作を要約する。

## Changes

- 主な変更点を書く。

## Verification

- `command` — passed
```

## 安全境界

- `main`へ直接commitまたはpushしない。
- 現在のタスクに属する変更だけをstageする。
- 明示依頼がない限り、force push、amend、rebase、merge、release操作を行わない。
- PR作成前にリポジトリ指定の検証を実行し、実際に実行した結果だけを報告する。
- 依頼された操作で停止する。commitだけの依頼はpushやPR作成を許可しない。
