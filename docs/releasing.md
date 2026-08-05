# リリース運用

この文書は、スタンドアロンバイナリを公開するメンテナー向けに、GitHubリポジトリ側の保護設定、
リリースワークフロー、開始手順、復旧方針を記録します。実作業では
[`github-release` Skill](../.agents/skills/github-release/SKILL.md)を使用します。

## リリース開始手順

バージョン更新とタグのプッシュを一度の作業として扱わず、必ず`prepare`と`start`に分けます。

### Prepare: バージョン更新PR

1. 前回のリリースからの変更を確認し、SemVerのメジャー、マイナー、パッチのどれを上げるか決める。
2. 厳密な安定版SemVer形式のバージョンを選ぶ。先頭ゼロ、プレリリース、ビルドメタデータは使用しない。
3. `origin/main`からリリース用ブランチを作り、`package.json`のバージョンと必要なロックファイルだけを更新する。
4. `bun run check`、`bun test`、`bun run format:check`、`bun run build`を実行する。
5. バージョン、変更種別、検証結果を記載したPRを作成する。
6. CIの成功と差分をレビューし、mainへマージする。マージが完了するまではタグを作成しない。

バージョン変更をmainへ直接プッシュしません。マージ前に問題が見つかった場合は同じPRを修正し、CIを
再実行します。マージ後に別の問題が見つかった場合も、mainを直接修正せず新しいPRを使用します。

### Start: マージ後のタグをプッシュ

作業ツリーがクリーンな`main`で、対象タグを指定してpreflightを実行します。

```bash
git switch main
bash .agents/skills/github-release/scripts/preflight.sh vX.Y.Z
```

preflightは`origin/main`をフェッチし、mainとの同期、厳密なSemVer形式、`package.json`のバージョン、対象SHAの
main CI成功、同名タグとReleaseまたはドラフトが存在しないことを検査します。成功出力に含まれるバージョン、
コミットSHA、CI結果と実行URL、予定タグをメンテナーが確認した後、明示的な承認を得た場合に限り、Skillが
注釈付きタグを作成して通常のプッシュを実行します。強制プッシュは使用しません。

タグのプッシュが`.github/workflows/release.yml`を起動します。バージョンをGitHub Actionsのフォームへ再入力したり、
`gh workflow run`で起動したりしません。Skillが示すワークフロー実行URLを開き、ビルド、ネイティブ環境のスモークテスト、
チェックサム、アテステーションの成功を確認します。`publish`ジョブが待機したらGitHub UIの
**Review deployments**で`release` Environmentを選択し、承認します。Environmentの承認をAPIで
自動化せず、管理者バイパスも使用しません。ローカルからReleaseやアセットを作成・アップロードしません。

## 権限モデル

リリースの開始と公開承認は、次の2段階に分けます。

1. `u7chan` がmain履歴上のコミットへ`vX.Y.Z`タグを作成する
2. `u7chan` が`release` Environmentのデプロイを承認する

実際の公開処理は、承認後にGitHub Actionsが行います。単独メンテナーで運用するため
セルフレビューは許可しますが、管理者によるEnvironment保護のバイパスは許可しません。

## リリースワークフロー

`.github/workflows/release.yml`は安定版SemVer形式のタグをプッシュした場合だけ起動します。
`workflow_dispatch`は設けず、Releaseのバージョンをワークフロー入力から指定することはできません。
タグフィルターは起動範囲を絞るための境界であり、ビルド前に次の条件を改めて検証します。

- タグが先頭ゼロ、プレリリース、ビルドメタデータを含まない厳密な`vX.Y.Z`である
- タグのバージョンが`package.json`のバージョンと一致する
- 注釈付きタグまたは軽量タグから解決したコミットが`origin/main`の履歴上にある
- 同じタグのReleaseまたはドラフトがまだ存在しない

検証後は次の順で処理します。

1. check、test、format checkを実行する
2. Linux x64/arm64のアーカイブをビルドし、アーカイブ構造を検証する
3. 各アーカイブをネイティブアーキテクチャのランナーへ渡し、展開したバイナリでスモークテストを実行する
4. 両アーカイブの`SHA256SUMS`を生成し、その場で検証する
5. 両アーカイブを対象とするビルドプロベナンスをGitHub Attestationsへ登録する
6. `publish`ジョブだけが`release` Environmentの承認を待つ
7. 承認後にドラフトを作成し、3つのアセットの完全性を確認してから公開する

### Launch Profileのスモークテスト契約

ネイティブ環境のスモークテストでは、`cagent config init`で生成される設定を使います。生成された設定の
`default_profile`を解決するドライランを実行し、`# Resolved profile: balanced`が出力される
ことを確認します。これはエージェントCLIや外部モデルを起動せず、スタンドアロンバイナリが新しい
Launch Profile設定を読み取れることだけを検証します。

```bash
CAGENT_CONFIG="$config_path" "$binary" config init
test -f "$config_path"
CAGENT_CONFIG="$config_path" "$binary" --dry-run \
  | grep -F '# Resolved profile: balanced'
```

実際のネイティブ環境のスモークテストでは、隔離ディレクトリの`.env`や`bunfig.toml`から設定・preloadが注入
されないことも併せて確認します。

ARM64のスモークテストにはGA済みのGitHubホストランナー `ubuntu-24.04-arm`を使用します。PRの
`release-validation`もx64/arm64の両方のネイティブランナーで`bun run release:check`を実行します。
ランナーのアーキテクチャはログへ出力し、ランナーまたはセットアップの障害とバイナリスモークテストの失敗を区別します。

### ジョブごとの権限

ワークフロー全体の`permissions`は空です。ジョブごとの権限とコード実行の境界は次のとおりです。

| ジョブ | 権限 | リポジトリコードの実行 |
| --- | --- | --- |
| `release-guard` | `contents: read` | なし |
| `validate-build` | `contents: read` | あり |
| `native-smoke` | `contents: read` | アーカイブ内のバイナリだけ |
| `checksums` | `contents: read` | なし |
| `attest` | `contents: read`, `id-token: write`, `attestations: write` | なし |
| `publish` | `contents: write` | なし |

すべてのアクションとBunのバージョンは固定します。`attest`と`publish`ではチェックアウト、パッケージインストール、
リポジトリのスクリプトを実行しません。ビルドしたアーカイブと最終アセットは、1日で削除される
ワークフローアーティファクトで受け渡します。実行IDと試行番号を含む名前にして、再実行時の混同を防ぎます。

### ドラフトと再実行

`publish`ジョブはEnvironment承認後、ドラフトを含む既存のReleaseがないことを再確認してから、空のドラフトを
作成します。アセットのアップロードに`--clobber`を使用せず、3つのアセットすべてがアップロード済みで
空でないことをAPIで確認したドラフトだけを公開します。

アップロード途中で失敗した場合は、不完全なドラフトを削除・再利用しません。ワークフローを再実行しても既存の
ドラフトを検出して停止するため、アセットは上書きされません。そのバージョンは破棄し、修正後に新しい
バージョンでReleaseをやり直します。同じタグの実行は`concurrency`で直列化し、進行中の実行をキャンセルしません。

### 公開後の検証

Releaseのアセットをダウンロードし、次を実行します。Immutable Releaseが自動生成するリリースアテステーションと、
ワークフローが登録するビルドプロベナンスは別々に検証します。

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

### タグ用ルールセット

| ルールセット | 対象 | ルール | バイパス |
| --- | --- | --- | --- |
| `release-tag-creation` | `refs/tags/v*` | 作成制限 | `u7chan`ユーザーのみ |
| `release-tag-immutability` | `refs/tags/v*` | 更新・削除制限 | なし |

作成と更新・削除を別のルールセットにすることで、タグを作成できるメンテナーにもタグの移動・削除に対する
バイパス権限を与えません。いずれも適用状態は`active`です。

### `release` Environment

| 設定 | 値 |
| --- | --- |
| 必須レビュー担当者 | `u7chan` |
| セルフレビューの防止 | 無効 |
| 管理者バイパス | 無効 |
| デプロイ対象ref | 選択したタグ |
| タグパターン | `v*` |

`v*`はリポジトリ設定における粗い境界です。安定版SemVer、`package.json`のバージョン、タグ、
アセット名の完全一致はリリースワークフローで別途検証します。

### Immutable Releases

リポジトリのImmutable Releasesを有効にしています。公開済みReleaseのアセットと対応するタグは
変更せず、同じタグ名を再利用しません。すべてのアセットをドラフトへ添付して検証してから
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

- 両ルールセットの対象がタグ、適用状態が`active`、対象パターンが`refs/tags/v*`である
- `release-tag-creation`が作成を制限し、バイパス対象が`u7chan`のユーザーIDだけである
- `release-tag-immutability`が更新・削除を制限し、バイパス対象がない
- `release` Environmentのレビュー担当者が`u7chan`で、セルフレビューが許可され、管理者バイパスが無効である
- デプロイブランチポリシーがタグ種別の`v*`だけである
- Immutable Releasesの`enabled`が`true`である

Environmentの承認待ちとrefの制限は、本番ワークフローへ手動トリガーを追加せず、安全な
リハーサルで確認します。承認・拒否・キャンセルの前にドラフトが作られないこともAPIで確認します。

保護対象タグの強制更新・削除拒否は、通常の`v*`と重ならない一意で使い捨てのタグ用名前空間と
完全一致するrefだけを対象とする一時ルールセットを使って、管理者が手動で検証します。検証後は一時ルールセットを先に削除し、
使い捨てタグを削除します。その後、通常の2つのルールセットを詳細APIで再取得し、検証前の設定と一致する
ことを確認します。拒否結果と復旧確認はIssueへ記録します。この検証用の管理者権限はリリースワークフローへ
付与しません。

## 失敗時の復旧

タグやReleaseを上書きして復旧しません。失敗した段階に応じて、次のように対応します。

### タグ作成前

バージョン更新PRまたはリリース対象コミットを修正し、mainへマージしてからpreflightをやり直します。

### タグ作成後、公開前

ワークフローを停止し、作成済みタグは移動・削除しません。未公開ドラフトがあれば公開せず、失敗した
バージョンを破棄します。修正をmainへマージし、次のバージョンで新しいタグからやり直します。

### 公開後

公開済みRelease、アセット、タグは変更・削除しません。修正をmainへマージし、次のバージョンとして
新しいReleaseを公開します。

### 保護設定の不一致

新しいタグを作成せず、Releaseに関する操作を停止します。リポジトリの設定画面または管理APIでこの文書の
設定に戻し、上記APIですべての値を再確認してから再開します。緊急対応でもタグの移動・削除、
管理者バイパスによる公開は行いません。

## 初回リリースのリハーサルチェックリスト

初回の本番リリースでは、各項目をメンテナーが確認し、結果とURLをIssueへ記録します。

- [ ] バージョン更新が機能ブランチのPRだけに含まれ、mainへ直接プッシュされていない
- [ ] バージョン更新PRのCIが成功し、マージコミットが`origin/main`へ反映されている
- [ ] 作業ツリーがクリーンな`main`でSkillのpreflightが成功した
- [ ] preflightのバージョン、コミットSHA、CI実行URL、予定タグを目視確認した
- [ ] 明示的な承認前にローカル・リモートのタグが作成されていない
- [ ] 承認後のタグがpreflightで示したSHAを指している
- [ ] タグをプッシュするだけでリリースワークフローが起動し、ワークフロー実行URLを記録した
- [ ] `release` Environmentの承認前にReleaseまたはドラフトが作成されていない
- [ ] GitHub UIから`release` Environmentを承認し、バイパスを使用していない
- [ ] x64/arm64のネイティブ環境スモークテスト、チェックサム、アテステーション、publishがすべて成功した
- [ ] 公開Releaseにx64アーカイブ、arm64アーカイブ、`SHA256SUMS`だけが存在する
- [ ] READMEのクリーンなWSL2/Linuxインストール、チェックサム、リリースの完全性、アテステーションを再現した
- [ ] タグ用ルールセット、Environment、Immutable Releasesが本書の設定と一致する
- [ ] 失敗時にタグの移動・削除、アセットの上書き、同じバージョンの再利用を行わない運用を確認した
