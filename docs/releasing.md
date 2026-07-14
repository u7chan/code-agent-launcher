# Release運用

この文書は、standalone binaryを公開するmaintainer向けに、GitHub repository側の
保護設定と復旧方針を記録します。Release workflowとtag作成手順はIssue #17、#18で
追加します。

## 権限モデル

Release開始と公開承認は、次の2段階で分離します。

1. `u7chan` がmain履歴上のcommitへ`vX.Y.Z` tagを作成する
2. `u7chan` が`release` Environmentのdeploymentを承認する

実際の公開処理は、承認後にGitHub Actionsが行います。単独maintainer運用のため
self-reviewは許可しますが、adminによるEnvironment保護のbypassは許可しません。

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

Environmentの承認待ちとref制限の実workflow確認は、Release workflowを追加するIssue #17で
実施します。保護対象tagのforce update・deleteが拒否されることも、既存Release tagへ影響しない
使い捨てtag namespaceと一時rulesetを用いてIssue #17で確認します。

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
