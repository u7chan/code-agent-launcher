# リリース運用

この文書は、`standalone`バイナリを公開するメンテナー向けに、GitHubリポジトリ側の保護設定、
Release workflow、開始手順、復旧方針を記録します。実作業では
[`github-release` Skill](../.agents/skills/github-release/SKILL.md)を使用します。

## リリース開始手順

バージョン更新とタグpushを一度の作業として扱わず、必ず`prepare`と`start`に分けます。

### Prepare: バージョン更新PR

1. 前回のリリースからの変更を確認し、SemVerのmajor、minor、patchのどれを上げるか決める。
2. strict stable SemVer形式のバージョンを選ぶ。leading zero、prerelease、build metadataは使用しない。
3. `origin/main`からリリース用ブランチを作り、`package.json`のバージョンと必要なlockfileだけを更新する。
4. `bun run check`、`bun test`、`bun run format:check`、`bun run build`を実行する。
5. バージョン、変更種別、検証結果を記載したPRを作成する。
6. CIの成功と差分をレビューし、mainへマージする。マージが完了するまではタグを作成しない。

バージョン変更をmainへ直接pushしません。マージ前に問題が見つかった場合は同じPRを修正し、CIを
再実行します。マージ後に別の問題が見つかった場合も、mainを直接修正せず新しいPRを使用します。

### Start: マージ後のタグpush

作業ツリーがcleanな`main`で、対象タグを指定してpreflightを実行します。

```bash
git switch main
bash .agents/skills/github-release/scripts/preflight.sh vX.Y.Z
```

preflightは`origin/main`をfetchし、mainとの同期、strict SemVer、`package.json`のバージョン、対象SHAの
main CI成功、同名タグとRelease/draftが存在しないことを検査します。成功出力に含まれるバージョン、
commit SHA、CI結果とrun URL、予定タグをメンテナーが確認した後、明示的な承認を得た場合に限り、Skillが
annotated tagを作成して通常のpushを実行します。force pushは使用しません。

タグpushが`.github/workflows/release.yml`を起動します。バージョンをGitHub Actionsのフォームへ再入力したり、
`gh workflow run`で起動したりしません。Skillが示すworkflow run URLを開き、ビルド、native smoke、
チェックサム、attestationの成功を確認します。`publish` jobが待機したらGitHub UIの
**Review deployments**で`release` Environmentを選択し、承認します。Environmentの承認をAPIで
自動化せず、admin bypassも使用しません。ローカルからReleaseやアセットを作成・アップロードしません。

## 権限モデル

リリースの開始と公開承認は、次の2段階に分けます。

1. `u7chan` がmain履歴上のcommitへ`vX.Y.Z` tagを作成する
2. `u7chan` が`release` Environmentのdeploymentを承認する

実際の公開処理は、承認後にGitHub Actionsが行います。単独メンテナーで運用するため
self-reviewは許可しますが、adminによるEnvironment保護のbypassは許可しません。

## リリースworkflow

`.github/workflows/release.yml`はstable SemVer形式のタグpushだけで起動します。
`workflow_dispatch`は設けず、Releaseのversionをworkflow入力から指定することはできません。
タグfilterは起動範囲を絞るための境界であり、ビルド前に次の条件を改めて検証します。

- タグがleading zero、prerelease、build metadataを含まない厳密な`vX.Y.Z`である
- タグのversionが`package.json`のversionと一致する
- annotated/lightweight tagをpeelしたcommitが`origin/main`の履歴上にある
- 同じタグのReleaseまたはdraftがまだ存在しない

検証後は次の順で処理します。

1. check、test、format checkを実行する
2. Linux x64/arm64のアーカイブをビルドし、アーカイブ構造を検証する
3. 各アーカイブをnative architectureのrunnerへ渡し、展開したバイナリをsmoke testする
4. 両アーカイブの`SHA256SUMS`を生成し、その場で検証する
5. 両アーカイブをsubjectとするbuild provenanceをGitHub Attestationsへ登録する
6. `publish` jobだけが`release` Environmentの承認を待つ
7. 承認後にdraftを作成し、3つのアセットの完全性を確認してから公開する

### Launch Profileのsmoke契約

native smokeでは、`cagent config init`で生成される設定を使います。生成された設定の
`default_profile`を解決するdry-runを実行し、`# Resolved profile: balanced`が出力される
ことを確認します。これはagent CLIや外部modelを起動せず、standaloneバイナリが新しい
Launch Profile設定を読み取れることだけを検証します。

```bash
CAGENT_CONFIG="$config_path" "$binary" config init
test -f "$config_path"
CAGENT_CONFIG="$config_path" "$binary" --dry-run \
  | grep -F '# Resolved profile: balanced'
```

実際のnative smokeでは、隔離ディレクトリの`.env`や`bunfig.toml`から設定・preloadが注入
されないことも併せて確認します。

ARM64 smokeにはGA済みのGitHub-hosted runner `ubuntu-24.04-arm`を使用します。PRの
`release-validation`もx64/arm64の両native runnerで`bun run release:check`を実行します。
runnerのアーキテクチャはログへ出力し、runner/setupの障害とバイナリsmokeの失敗を区別します。

### Jobごとの権限

ワークフロー全体の`permissions`は空です。jobごとの権限とコード実行の境界は次のとおりです。

| Job | Permissions | リポジトリコードの実行 |
| --- | --- | --- |
| `release-guard` | `contents: read` | なし |
| `validate-build` | `contents: read` | あり |
| `native-smoke` | `contents: read` | アーカイブ内のバイナリだけ |
| `checksums` | `contents: read` | なし |
| `attest` | `contents: read`, `id-token: write`, `attestations: write` | なし |
| `publish` | `contents: write` | なし |

すべてのActionとBunのバージョンは固定します。`attest`と`publish`ではcheckout、package install、
リポジトリのスクリプトを実行しません。ビルドしたアーカイブと最終アセットは、1日で削除される
workflow artifactで受け渡します。run IDとattemptを含む名前にして、再実行時の混同を防ぎます。

### Draftと再実行

`publish`はEnvironment承認後、draftを含む既存のReleaseがないことを再確認してから、空のdraftを
作成します。アセットのアップロードに`--clobber`を使用せず、3つのアセットすべてがアップロード済みで
空でないことをAPIで確認したdraftだけを公開します。

アップロード途中で失敗した場合は、不完全なdraftを削除・再利用しません。workflowを再実行しても既存の
draftを検出して停止するため、アセットは上書きされません。そのバージョンは破棄し、修正後に新しい
バージョンでReleaseをやり直します。同じタグのrunはconcurrencyで直列化し、進行中のrunをcancelしません。

### 公開後の検証

Releaseのアセットをダウンロードし、次を実行します。Immutable Releaseが自動生成するrelease attestationと、
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

## リポジトリ設定

2026-07-14時点で、次の設定を有効にしています。GitHub上の設定を正とし、この文書は
確認用の記録です。

### タグruleset

| Ruleset | 対象 | Rule | Bypass |
| --- | --- | --- | --- |
| `release-tag-creation` | `refs/tags/v*` | creation制限 | `u7chan`ユーザーのみ |
| `release-tag-immutability` | `refs/tags/v*` | update・deletion制限 | なし |

作成と更新・削除を別のrulesetにすることで、タグを作成できるメンテナーにもタグの移動・削除に対する
bypassを与えません。いずれもenforcementは`active`です。

### `release` Environment

| Setting | Value |
| --- | --- |
| Required reviewer | `u7chan` |
| Prevent self-review | 無効 |
| Admin bypass | 無効 |
| Deployment refs | selected tags |
| Tag pattern | `v*` |

`v*`はリポジトリ設定における粗い境界です。stable SemVer、`package.json`のversion、タグ、
アセット名の完全一致はRelease workflowで別途検証します。

### Immutable Releases

リポジトリのImmutable Releasesを有効にしています。公開済みReleaseのアセットと対応するタグは
変更せず、同じタグ名を再利用しません。すべてのアセットをdraftへ添付して検証してから
公開します。

## 設定の確認

リポジトリ管理者権限を持つ`gh`で認証すれば、次のAPIで設定を確認できます。

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

確認時は、次の条件を満たすことを確認します。

- 両rulesetのtargetがtag、enforcementが`active`、対象patternが`refs/tags/v*`である
- `release-tag-creation`がcreationを制限し、bypass actorが`u7chan`のuser IDだけである
- `release-tag-immutability`がupdate・deletionを制限し、bypass actorがない
- `release` Environmentのreviewerが`u7chan`で、self-reviewが許可され、admin bypassが無効である
- deployment branch policyがtag typeの`v*`だけである
- Immutable Releasesの`enabled`が`true`である

Environmentの承認待ちとref制限は、production workflowへmanual triggerを追加せず、安全な
rehearsalで確認します。承認・reject・cancelの前にdraftが作られないこともAPIで確認します。

保護対象タグのforce update・delete拒否は、通常の`v*`と重ならない一意で使い捨てのタグ用名前空間と
exact refだけを対象とする一時rulesetを使って、管理者が手動で検証します。検証後は一時rulesetを先に削除し、
使い捨てタグを削除します。その後、通常の2つのrulesetを詳細APIで再取得し、検証前の設定と一致する
ことを確認します。拒否結果と復旧確認はIssueへ記録します。この検証用のadmin権限はRelease workflowへ
付与しません。

## 失敗時の復旧

タグやReleaseを上書きして復旧しません。失敗した段階に応じて、次のように対応します。

### タグ作成前

バージョン更新PRまたはリリース対象commitを修正し、mainへマージしてからpreflightをやり直します。

### タグ作成後、公開前

workflowを停止し、作成済みタグは移動・削除しません。未公開draftがあれば公開せず、失敗した
バージョンを破棄します。修正をmainへマージし、次のバージョンで新しいタグからやり直します。

### 公開後

公開済みRelease、アセット、タグは変更・削除しません。修正をmainへマージし、次のバージョンとして
新しいReleaseを公開します。

### 保護設定の不一致

新しいタグを作成せず、Release操作を停止します。リポジトリのSettingsまたは管理APIでこの文書の
設定に戻し、上記APIですべての値を再確認してから再開します。緊急対応でもタグの移動・削除、
admin bypassによる公開は行いません。

## 初回リリースのリハーサルチェックリスト

初回のproduction Releaseでは、各項目をメンテナーが確認し、結果とURLをIssueへ記録します。

- [ ] バージョン更新がfeature branchのPRだけに含まれ、mainへ直接pushされていない
- [ ] バージョン更新PRのCIが成功し、マージコミットが`origin/main`へ反映されている
- [ ] 作業ツリーがcleanな`main`でSkillのpreflightが成功した
- [ ] preflightのバージョン、commit SHA、CI run URL、予定タグを目視確認した
- [ ] 明示的な承認前にローカル・リモートのタグが作成されていない
- [ ] 承認後のタグがpreflightで示したSHAを指している
- [ ] タグpushだけでRelease workflowが起動し、workflow run URLを記録した
- [ ] `release` Environmentの承認前にReleaseまたはdraftが作成されていない
- [ ] GitHub UIから`release` Environmentを承認し、bypassを使用していない
- [ ] x64/arm64 native smoke、チェックサム、attestation、publishがすべて成功した
- [ ] 公開Releaseにx64アーカイブ、arm64アーカイブ、`SHA256SUMS`だけが存在する
- [ ] READMEのcleanなWSL2/Linuxインストール、チェックサム、リリースの完全性、attestationを再現した
- [ ] タグruleset、Environment、Immutable Releasesが本書の設定と一致する
- [ ] 失敗時にタグの移動・削除、アセットの上書き、同じバージョンの再利用を行わない運用を確認した
