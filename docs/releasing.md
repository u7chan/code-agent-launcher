# Release運用

この文書は、standalone binaryを公開するmaintainer向けに、GitHub repository側の
保護設定、Release workflow、復旧方針を記録します。tag作成手順はIssue #18で追加します。

## 権限モデル

Release開始と公開承認は、次の2段階で分離します。

1. `u7chan` がmain履歴上のcommitへ`vX.Y.Z` tagを作成する
2. `u7chan` が`release` Environmentのdeploymentを承認する

実際の公開処理は、承認後にGitHub Actionsが行います。単独maintainer運用のため
self-reviewは許可しますが、adminによるEnvironment保護のbypassは許可しません。

## Release workflow

`.github/workflows/release.yml`はstable SemVer形式のtag pushだけで起動します。
`workflow_dispatch`は設けず、Releaseのversionをworkflow入力から指定することはできません。
tag filterは起動範囲を絞る境界であり、build前に次の条件を改めて検証します。

- tagがleading zero、prerelease、build metadataを含まない厳密な`vX.Y.Z`である
- tagのversionが`package.json`のversionと一致する
- annotated/lightweight tagをpeelしたcommitが`origin/main`の履歴上にある
- 同じtagのReleaseまたはdraftがまだ存在しない

検証後は次の順で処理します。

1. check、test、format checkを実行する
2. Linux x64/arm64 archiveをbuildし、archive構造を検証する
3. 各archiveをnative architectureのrunnerへ渡し、展開したbinaryをsmoke testする
4. 両archiveの`SHA256SUMS`を生成し、その場で検証する
5. 両archiveをsubjectとするbuild provenanceをGitHub Attestationsへ登録する
6. `publish` jobだけが`release` Environmentの承認を待つ
7. 承認後にdraftを作成し、3 assetの完全性を確認してから公開する

ARM64 smokeにはGA済みのGitHub-hosted runner `ubuntu-24.04-arm`を使用します。PRの
`release-validation`もx64/arm64の両native runnerで`bun run release:check`を実行します。
runnerのarchitectureはlogへ出力し、runner/setupの障害とbinary smokeの失敗を区別します。

### Job権限

workflow全体の`permissions`は空です。jobごとの権限とcode実行境界は次のとおりです。

| Job | Permissions | Repository code execution |
| --- | --- | --- |
| `release-guard` | `contents: read` | なし |
| `validate-build` | `contents: read` | あり |
| `native-smoke` | `contents: read` | archive内binaryだけ |
| `checksums` | `contents: read` | なし |
| `attest` | `contents: read`, `id-token: write`, `attestations: write` | なし |
| `publish` | `contents: write` | なし |

すべてのActionとBun versionは固定します。`attest`と`publish`ではcheckout、package install、
repository scriptを実行しません。build archiveと最終assetは1日で削除されるworkflow artifactで
受け渡し、run IDとattemptを含む名前で再実行間の混同を防ぎます。

### Draftと再実行

`publish`はEnvironment承認後、draftを含む既存Releaseがないことを再確認してから、空のdraftを
作成します。asset uploadに`--clobber`を使用せず、3 assetすべてがuploadedかつ非空であることを
APIで確認したdraftだけを公開します。

upload途中で失敗した場合はpartial draftを削除・再利用しません。workflowを再実行しても既存draft
検出で停止するため、assetは上書きされません。そのversionは破棄し、修正後に新しいversionで
Releaseをやり直します。同一tagのrunはconcurrencyで直列化し、進行中のrunをcancelしません。

### 公開後の検証

Release assetをdownloadし、次を実行します。Immutable Releaseが自動生成するrelease attestationと、
workflowが登録するbuild provenanceは別々に検証します。

```bash
TAG=vX.Y.Z
REPOSITORY=u7chan/code-agent-launcher
gh release download "$TAG" --repo "$REPOSITORY" --dir "release-$TAG"
(cd "release-$TAG" && sha256sum --check --strict SHA256SUMS)
gh release verify "$TAG" --repo "$REPOSITORY"
gh release verify-asset "$TAG" "release-$TAG/cagent-$TAG-linux-x64.tar.gz" \
  --repo "$REPOSITORY"
gh release verify-asset "$TAG" "release-$TAG/cagent-$TAG-linux-arm64.tar.gz" \
  --repo "$REPOSITORY"
gh attestation verify "release-$TAG/cagent-$TAG-linux-x64.tar.gz" \
  --repo "$REPOSITORY" \
  --source-ref "refs/tags/$TAG" \
  --signer-workflow "$REPOSITORY/.github/workflows/release.yml"
gh attestation verify "release-$TAG/cagent-$TAG-linux-arm64.tar.gz" \
  --repo "$REPOSITORY" \
  --source-ref "refs/tags/$TAG" \
  --signer-workflow "$REPOSITORY/.github/workflows/release.yml"
```

## Repository設定

2026-07-14時点で、次の設定を有効化しています。GitHub上の設定が正であり、この文書は
確認用の記録です。

### Tag rulesets

| Ruleset | 対象 | Rule | Bypass |
| --- | --- | --- | --- |
| `release-tag-creation` | `refs/tags/v*` | creation制限 | `u7chan`ユーザーのみ |
| `release-tag-immutability` | `refs/tags/v*` | update・deletion制限 | なし |

作成と更新・削除を別rulesetにすることで、tagを作成できるmaintainerにもtag移動・削除の
bypassを与えません。いずれもenforcementは`active`です。

### `release` Environment

| Setting | Value |
| --- | --- |
| Required reviewer | `u7chan` |
| Prevent self-review | 無効 |
| Admin bypass | 無効 |
| Deployment refs | selected tags |
| Tag pattern | `v*` |

`v*`はrepository設定での粗い境界です。stable SemVer、`package.json` version、tag、
asset名の完全一致はRelease workflowで別途検証します。

### Immutable Releases

RepositoryのImmutable Releasesを有効化しています。公開済みReleaseのassetと対応tagは
変更せず、同じtag名を再利用しません。すべてのassetをdraftへ添付して検証してから
公開します。

## 設定確認

repository admin権限のある`gh`認証で、次のAPIから設定を確認できます。

```bash
gh api 'repos/u7chan/code-agent-launcher/rulesets?includes_parents=true' \
  --jq '.[] | select(.name == "release-tag-creation" or .name == "release-tag-immutability") | .id' \
  | xargs -I{} gh api repos/u7chan/code-agent-launcher/rulesets/{}
gh api users/u7chan --jq '.id'
gh api repos/u7chan/code-agent-launcher/environments/release
gh api repos/u7chan/code-agent-launcher/environments/release/deployment-branch-policies
gh api -H 'X-GitHub-Api-Version: 2026-03-10' \
  repos/u7chan/code-agent-launcher/immutable-releases
```

確認時は次を満たすことを確認します。

- 両rulesetのtargetがtag、enforcementが`active`、対象patternが`refs/tags/v*`である
- `release-tag-creation`がcreationを制限し、bypass actorが`u7chan`のuser IDだけである
- `release-tag-immutability`がupdate・deletionを制限し、bypass actorがない
- `release` Environmentのreviewerが`u7chan`、self-reviewが許可、admin bypassが無効である
- deployment branch policyがtag typeの`v*`だけである
- Immutable Releasesの`enabled`が`true`である

Environmentの承認待ちとref制限は、production workflowへmanual triggerを追加せず、安全な
rehearsalで確認します。承認・reject・cancel前にdraftが作られないこともAPIで確認します。

保護対象tagのforce update・delete拒否は、通常の`v*`と重ならない一意な使い捨てtag namespaceと
exact refだけを対象とする一時rulesetで管理者が手動検証します。検証後は一時rulesetを先に削除し、
使い捨てtagを削除します。その後、通常の2つのrulesetを詳細APIで再取得し、検証前の設定と一致する
ことを確認して、拒否結果と復旧確認をIssueへ記録します。この検証用のadmin権限はRelease workflowへ
付与しません。

## 失敗時の復旧

tagやReleaseを上書きして復旧しません。失敗した段階に応じて次のように対応します。

### Tag作成前

Version更新PRまたはRelease対象commitを修正し、mainへmergeしてからpreflightをやり直します。

### Tag作成後、公開前

workflowを停止し、作成済みtagは移動・削除しません。未公開draftがあれば公開せず、失敗した
versionを破棄します。修正をmainへmergeし、次のversionで新しいtagからやり直します。

### 公開後

公開済みRelease、asset、tagは変更・削除しません。修正をmainへmergeし、次のversionとして
新しいReleaseを公開します。

### 保護設定の不一致

新しいtagを作成せず、Release操作を停止します。repository Settingsまたは管理APIでこの文書の
設定へ戻し、上記APIですべての値を再確認してから再開します。緊急対応でもtag移動、tag削除、
admin bypassによる公開は行いません。
