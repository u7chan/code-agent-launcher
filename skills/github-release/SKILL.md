---
name: github-release
description: Prepare and start code-agent-launcher maintainer releases with a version-update PR, merge boundary, guarded tag push, and GitHub Environment handoff. Use for requests such as "release", "リリースして", "Version更新PRを作って", "tagを作って", or "Releaseを開始して" in this repository.
---

# GitHub Release

Releaseを`prepare`と`start`に分ける。Version更新PRのmerge前は`prepare`で停止し、merge済みの
`origin/main`だけを`start`の対象にする。

## 絶対に守る境界

- Version変更をmainへ直接pushしない。
- Version更新PRのmerge前commitへrelease tagを作成しない。
- tagをforce updateまたはdeleteしない。失敗したtag名を再利用しない。
- `gh workflow run`でrelease workflowを起動しない。tag pushだけを起点にする。
- local machineからGitHub Releaseを作成せず、assetもuploadしない。
- `release` Environmentの承認を自動化またはbypassしない。
- tag push前に、その時点のpreflight結果を示して新たな明示承認を得る。最初の「リリースして」
  という依頼や`prepare`の承認をtag pushの承認として扱わない。

## Phaseを決める

1. ユーザーが`prepare`または`start`を指定した場合は、そのphaseだけを実行する。
2. 指定がなく、希望Versionが`origin/main`の`package.json`に未反映なら`prepare`を実行する。
3. 希望Versionがmerge済みなら`start`を実行する。
4. Versionやrelease対象が曖昧なら、履歴から候補とSemVerの変更種別を提示し、人間に決定を求める。

## Prepare: Version更新PR

1. `git status --short --branch`、現在branch、`package.json`のVersion、`origin/main`を調べる。
2. 希望Versionがleading zero、prerelease、build metadataを含まないstrict SemVer
   `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`であり、現在Versionより大きいことを検証する。
3. worktreeがdirtyなら停止する。`main`から作業する場合も、まず`origin/main`と同期したrelease用branchを
   作成する。既存の適切なfeature branchがあれば使用してよい。
4. `package.json`の`version`だけを更新する。install時にlockfileへVersionが記録される構成なら、
   lockfileも通常のpackage manager操作で更新する。tagを作るversion commandは使わない。
5. `bun run check`、`bun test`、`bun run format:check`、必要に応じて`bun run build`を実行する。
6. diffがVersion更新と必要な付随変更だけであることを示し、commit、push、Version更新PRを作成する。
   PR本文にVersion、変更種別、検証結果、merge後に`start`が必要であることを書く。
7. PR URLを示し、**merge待ちで停止する**。mergeを推測せず、tagを作成しない。

## Start: merge済みmainから開始

### 1. Preflight

希望tagを`vX.Y.Z`形式で指定して、repository rootから次を実行する。

```bash
bash skills/github-release/scripts/preflight.sh vX.Y.Z
```

このscriptはtagを作成せず、次をすべて検査する。1つでも失敗したら修正またはmerge後に最初から
やり直し、tag操作へ進まない。

- release workflowがmerge済みcommitに存在する
- worktreeがcleanで、現在branchが`main`である
- `origin/main`をfetchした後、`HEAD`、local `main`、`origin/main`が同一commitである
- repositoryが`u7chan/code-agent-launcher`である
- tagがstrict SemVer `vX.Y.Z`で、`package.json`のVersionと一致する
- 対象commitのmain push CIがcompletedかつsuccessである
- 同名tagがlocalとoriginのどちらにも存在しない
- 同名GitHub Releaseまたはdraftが存在しない

### 2. Tag pushの承認

preflightが成功したら、出力された次の4項目をそのまま提示する。

- Version
- commit SHA
- CI結果とworkflow run URL
- 作成予定tag

「上記tagをこのcommitへ作成してoriginへpushしてよいですか」と質問し、そこで停止する。
ユーザーが表示後の別メッセージで明示的に承認した場合だけ、preflightを再実行する。結果が同一なら、
出力値を環境変数へ手入力せず、検査済みのtagと`git rev-parse HEAD`を使って次を実行する。

```bash
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
SHA="$(git rev-parse HEAD)"
git tag --annotate "$TAG" "$SHA" --message "Release $TAG"
git push origin "refs/tags/$TAG:refs/tags/$TAG"
```

`--force`を付けない。pushが拒否または失敗したら停止し、tagの移動・削除・再作成を行わない。

### 3. Workflowと人間承認へhandoff

tag push後、`Release` workflowの`headBranch`がtag、`headSha`が対象SHAであるrunを
`gh run list --workflow release.yml --event push`で探し、そのrun URLを示す。見つからない場合も
`gh workflow run`は使わず、GitHub ActionsのRelease workflow画面でtag起点runの反映を待つよう案内する。

```bash
gh run list --repo u7chan/code-agent-launcher --workflow release.yml --event push \
  --commit "$SHA" --limit 20 --json headBranch,headSha,status,conclusion,url \
  --jq ".[] | select(.headBranch == \"$TAG\" and .headSha == \"$SHA\")"
```

runの`publish` jobが待機したら、run URLをブラウザで開き、GitHub UIの
**Review deployments**から`release` Environmentを選択し、内容を再確認して承認するよう案内する。
承認APIを呼ばず、admin bypassを使わない。公開後のchecksum、release integrity、attestation検証は
[`README.md`](../../README.md)と[`docs/releasing.md`](../../docs/releasing.md)に従う。

## 失敗時

- tag作成前: Version更新PRまたは対象commitを修正し、mainへmergeしてpreflightをやり直す。
- tag作成後: tagを変更・削除しない。workflowを停止し、修正を新しいVersionのPRへ入れる。
- draftまたは公開後: Releaseやassetを上書きしない。該当Versionを破棄し、新しいVersionでやり直す。
- 保護設定不一致: 新しいtagを作成せず、[`docs/releasing.md`](../../docs/releasing.md)の設定へ戻して再確認する。
