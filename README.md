# code-agent-launcher

[![CI](https://img.shields.io/github/actions/workflow/status/u7chan/code-agent-launcher/ci.yml?branch=main&label=CI&style=flat&logo=github)](https://github.com/u7chan/code-agent-launcher/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/u7chan/code-agent-launcher/release.yml?label=Release&style=flat&logo=github)](https://github.com/u7chan/code-agent-launcher/actions/workflows/release.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.10-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![License](https://img.shields.io/github/license/u7chan/code-agent-launcher?style=flat)](LICENSE)

コーディングエージェント用ランチャー。CLI コマンドは `cagent` です。

## 主な機能

- `low` / `mid` / `high` のタスクレベルに応じてデフォルトモデルを解決
- ユーザーが `--model` を明示した場合はそれを最優先
- 推論 effort（reasoning effort）を `--effort` / `CAGENT_EFFORT` / レベル設定で制御
  - Codex: `-c model_reasoning_effort=<TOML文字列>` として渡す
  - OpenCode Go (run): `--variant` として渡す
  - OpenCode Go (対話): 未対応のため effort 解決時に fail-fast

### effort の優先順位

高い順:

1. `--effort` CLI オプション
2. `CAGENT_EFFORT` 環境変数
3. レベルの `effort` 設定（`levels.<name>.effort`）
4. 指定なし（各 CLI の現在設定を継承）

### 優先順位の補足

- `--model` を単独指定した場合、`default_level` の effort は継承しない（レベルが明示されないため）
- `--model --level <level>` でレベルを同時指定した場合は、そのレベルの effort が適用される
- `--effort` / `CAGENT_EFFORT` / level effort のいずれも指定がない場合、effort は CLI に渡されず、CLI 側の現在設定が使われる

### 対話 / 非対話 対応表

| エージェント | モード    | effort 対応                    |
| ------------ | --------- | ------------------------------ |
| Codex        | exec (非対話) | `-c model_reasoning_effort` |
| Codex        | 対話      | `-c model_reasoning_effort`    |
| OpenCode Go  | run (非対話)  | `--variant`                 |
| OpenCode Go  | 対話      | 未対応（fail-fast）           |

### YAML 設定例（effort あり）

```yaml
default_agent: codex
default_level: mid
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
    levels:
      low:
        description: Simple
        default_model: gpt-5.6-luna
        models: [gpt-5.6-luna]
        effort: low
      mid:
        description: Normal
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
        effort: mid
      high:
        description: Complex
        default_model: gpt-5.6-sol
        models: [gpt-5.6-sol]
        effort: high
multiplexer:
  default: herdr
  herdr:
    enabled: true
```
- 非対話実行用の `run` コマンド
- Herdr 連携用の `mux` コマンド
- 設定と環境の検証用 `doctor` コマンド

## 主なコマンド例

```bash
# 非対話実行
cagent run low -- "READMEの表記ゆれを直して"
cagent run mid -- "このIssueの実装方針を作り、必要な変更点を列挙して"
cagent run high -- "この認証設計のリスクと代替案をレビューして"

# 明示モデル指定
cagent run --agent opencode-go --model qwen3.7-max -- "DBマイグレーション計画をレビューして"

# 推論 effort 指定
cagent run --effort high -- "難易度の高いコードレビューをして"
cagent run --effort high low -- "低レベルタスクだけど effort 高めで"

# Herdr 経由で永続セッションを立てる
cagent mux start high

# Herdr 経由で 1 回実行
cagent mux run mid -- "このIssueを調査して"

# 設定と環境の検証
cagent doctor
```

## エージェント向けルール

設定ファイルは `~/.config/cagent/config.yaml` です。環境変数には `CAGENT_CONFIG` / `CAGENT_AGENT` / `CAGENT_MODEL` / `CAGENT_LEVEL` / `CAGENT_EFFORT` を使用します。

## Linuxへのinstall

standalone releaseはLinux glibcのx64とarm64を提供します。WSL2のUbuntuなど、glibcベースの
Linux distributionでも同じ手順を使用できます。GitHubのReleases画面でVersionを確認し、
architectureに合うarchiveをdownloadしてください。`curl`、`tar`、GNU `sha256sum`を使用します。

```bash
VERSION=0.1.0
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

curl --fail --location --remote-name \
  "https://github.com/u7chan/code-agent-launcher/releases/download/v${VERSION}/cagent-v${VERSION}-linux-${ARCH}.tar.gz"
curl --fail --location --remote-name \
  "https://github.com/u7chan/code-agent-launcher/releases/download/v${VERSION}/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS

tar -xzf "cagent-v${VERSION}-linux-${ARCH}.tar.gz"
mkdir -p "$HOME/.local/bin"
install -m 0755 "cagent-v${VERSION}-linux-${ARCH}/cagent" "$HOME/.local/bin/cagent"
"$HOME/.local/bin/cagent" --version
```

`$HOME/.local/bin`が`PATH`に含まれない場合は、shellの設定へ追加してください。system-wideに
installする場合だけ、配置先を`/usr/local/bin/cagent`へ変更して必要な権限を使用します。

### Update

新しいVersionとarchitectureを指定して上記のdownload、checksum検証、展開を繰り返し、最後に
`install -m 0755`で既存binaryを置き換えます。検証前に既存binaryを削除しないでください。
設定は`~/.config/cagent/config.yaml`にあり、binaryの更新では変更されません。

### Release integrityとattestation

`SHA256SUMS`はdownload時の破損とassetの取り違えを検出します。さらにGitHub CLIで、Immutable
Release由来のrelease attestationと、Release workflowが生成したbuild provenanceを検証できます。
これらのsubcommandを含む最新版のGitHub CLIをinstallし、`gh auth login`を済ませてください。
利用中のCLIが対応しているかは`gh release verify --help`と`gh attestation verify --help`で確認できます。

```bash
VERSION=0.1.0
TAG="v${VERSION}"
ARCH=x64 # arm64の場合はarm64へ変更
ASSET="cagent-${TAG}-linux-${ARCH}.tar.gz"
REPOSITORY=u7chan/code-agent-launcher

gh release verify "$TAG" --repo "$REPOSITORY"
gh release verify-asset "$TAG" "$ASSET" --repo "$REPOSITORY"
gh attestation verify "$ASSET" \
  --repo "$REPOSITORY" \
  --source-ref "refs/tags/$TAG" \
  --signer-workflow "$REPOSITORY/.github/workflows/release.yml"
```

checksum、release integrity、attestationのいずれかが失敗したassetは実行せず、download元、Version、
architectureを確認してください。`SHA256SUMS`にdownloadしたarchive名が含まれることも確認します。

### Uninstall

```bash
rm "$HOME/.local/bin/cagent"
```

system-wideに配置した場合は、実際の配置先から削除します。設定も不要なら
`~/.config/cagent/`を別途削除できますが、再installに備えて残しても問題ありません。

### Support範囲

- 対象: Linux glibc x64、Linux glibc arm64、これらの環境を提供するWSL2
- 対象外: macOS native、Windows native、muslベースdistribution、上記以外のarchitecture
- sourceからの開発実行: Node.js 18+とBunを使用する本READMEの開発手順に従う

## ローカル検証

Codex向けの検証設定は [`validation/`](validation/) で管理します。

```bash
# テストビルドとCodexモデルのルーティングを確認
bun run validate smoke --profile core

# Codex CLIも実際に起動
bun run validate smoke --profile core --live
```

Codexのモデル対応は `low=gpt-5.6-luna`、`mid=gpt-5.6-terra`、`high=gpt-5.6-sol` です。実行結果は `validation/.artifacts/` に保存され、Git管理しません。

## Release 事前検証

Releaseに使用するGitHub repository保護と、失敗時の復旧方針は
[`docs/releasing.md`](docs/releasing.md) を参照してください。
maintainerがVersion更新PRまたはReleaseを開始するときは
[`skills/github-release/SKILL.md`](skills/github-release/SKILL.md) を使用します。

通常 CI は Bun 1.3.10 を使い、Linux x64 standalone の build・pack、archive
構造、SHA-256 checksum、隔離 smoke test を検証します。ローカルでは Linux x64
環境で同じ検証を次の command から実行できます。

```bash
bun run release:check
```

smoke test は repository 外の一時 directory で `cagent --version`、`cagent --help`、
一時 `CAGENT_CONFIG` を使う `cagent config init` を実行します。実行 directory の
`.env` と `bunfig.toml` が環境変数や preload を注入しないことも確認します。

明示した stable SemVer tag と `package.json` version、および生成済み archive を検証する
場合は次の command を使用します。archive は展開せず entry 一覧を検査します。

```bash
bun run release:validate -- --tag v0.1.0
bun run release:validate -- --tag v0.1.0 \
  --archive release/cagent-v0.1.0-linux-x64.tar.gz --arch x64
```

checksum 処理は後続の release workflow から次の形で再利用できます。

```bash
bun run release:checksum -- generate release/SHA256SUMS release/*.tar.gz
bun run release:checksum -- verify release/SHA256SUMS release
```

## Standalone release artifact

`bun run build:standalone` は Linux glibc x64 baseline と arm64 向けの standalone
archive を `release/` に生成します。各 archive は次の固定構造です。

```text
cagent-vX.Y.Z-linux-<arch>/
  cagent
  README.md
  LICENSE
```

archive は固定のファイル順、mtime、owner/group、gzip timestamp で生成します。同じ入力と
固定した Bun toolchain では archive の再現性を確認できます。一方、Bun standalone binary
自体の byte-for-byte 再現性は保証対象ではありません。
