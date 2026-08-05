# code-agent-launcher

[![CI](https://github.com/u7chan/code-agent-launcher/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/u7chan/code-agent-launcher/actions/workflows/ci.yml)
[![Release](https://github.com/u7chan/code-agent-launcher/actions/workflows/release.yml/badge.svg)](https://github.com/u7chan/code-agent-launcher/actions/workflows/release.yml)
[![TypeScript](https://badgen.net/static/TypeScript/5.5%2B/3178C6?icon=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://badgen.net/static/Node.js/%3E%3D18/339933?icon=nodejs)](https://nodejs.org/)
[![Bun](https://badgen.net/static/Bun/1.3.10/000000)](https://bun.sh/)
[![License](https://badgen.net/github/license/u7chan/code-agent-launcher)](LICENSE)

コーディングエージェント用ランチャーです。CLIコマンドは `cagent` です。

## Launch Profile

`cagent` は、名前付きのLaunch Profileから実行先を解決します。Profileは実行時に必要な
`agent`、`model`、任意の `effort` をまとめたプリセットです。

Profile名は任意に付けられます。`reviewer` や `reasoner` という名前を付けても、cagentが
promptの内容からタスクを分類したり、その名前からroleやworkflowを推測したりはしません。
Profileはprompt、role、workflowを持たない実行プリセットであり、promptはCLI引数として
渡します。

### 最小の有効な設定

設定ファイルは `~/.config/cagent/config.yaml` です。`CAGENT_CONFIG` を設定すると別の
ファイルを指定できます。次の例は、`default_profile`、`profiles`、`agents`に加えて、
実装が必須とする `default_agent` と `multiplexer` も含む最小の有効な設定です。

```yaml
default_agent: codex
default_profile: worker

agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false
  opencode-go:
    bin: opencode
    provider: opencode-go
    model_id_prefix: true

profiles:
  worker:
    agent: codex
    model: gpt-5.6-terra
  reasoner:
    agent: codex
    model: gpt-5.6-sol
    effort: high
  reviewer:
    agent: opencode-go
    model: deepseek-v4-pro

multiplexer:
  default: herdr
  herdr:
    enabled: true
    start_command_template: "cagent {profile}"
    run_command_template: "cagent run {profile} -- {prompt}"
```

`reviewer` は任意に付けたProfile名の例です。Profileごとに異なる `agent` を指定できる
ため、上の例ではCodexとOpenCode Goを同じ設定で使い分けています。Profileの `agent` は
`agents` に定義された名前でなければなりません。

`cagent config init` は、CodexとOpenCode GoのProfileを含む既定設定を作成します。内容を
確認するだけなら `cagent config init --dry-run` を使えます。設定ファイルを作成せずに
自分のProfileを定義したい場合は、上のYAMLを保存してください。

### 解決の優先順位

Profileの選択は、次の順に高くなります。

1. CLIで明示したProfile（`cagent reviewer`、`cagent run reviewer -- ...`）
2. `CAGENT_PROFILE`
3. `default_profile`

`cagent mux start <profile>` と `cagent mux run <profile>` は、実装上Profileを位置引数で
必ず指定します。`default_profile` は、Profileを省略できる対話実行・非対話実行で使われる
既定値です。`default_profile` を設定しない場合は、Profileを明示する必要があります。

選択されたProfileの値に対する上書きの優先順位も、CLI、環境変数、Profileの順です。

- model: `--model` → `CAGENT_MODEL` → `profiles.<name>.model`
- effort: `--effort` → `CAGENT_EFFORT` → `profiles.<name>.effort`

Profileでeffortを指定しない場合、effortはagent CLIへ渡されず、agent側の設定が使われます。
Codexでは `-c model_reasoning_effort="<effort>"`、OpenCode Goの非対話実行では
`--variant <effort>` に変換されます。OpenCode Goの対話セッションはeffortに対応しない
ため、effort付きProfileを `mux start` で使うと失敗します。

## CLIの使い方

### 対話実行

引数なしなら `default_profile` を使います。Profileを位置引数で指定することもできます。
対話実行はTTYが必要です。

```bash
# default_profile（worker）で起動
cagent

# reviewerを明示して起動
cagent reviewer
```

### 非対話実行

`run` のpromptは `--` の後ろに渡します。Profileを省略すると、`CAGENT_PROFILE`、
`default_profile` の順に解決されます。

```bash
# default_profileで1回実行
cagent run -- "READMEを確認して改善点を列挙して"

# reviewerを明示して実行
cagent run reviewer -- "この変更をレビューして"

# modelとeffortをCLIから上書き
cagent run reasoner --model gpt-5.6-luna --effort high -- "設計上のリスクを整理して"
```

### dry-run

`--dry-run` は解決したProfileと、agentを起動せずに実行するコマンドを表示します。
`--json` を併用すると `run.plan` のJSONを出力します。

```bash
cagent --dry-run reasoner
cagent run reviewer --dry-run -- "この変更をレビューして"
cagent run reviewer --dry-run --json -- "この変更をレビューして"
```

通常出力は、例えば `cagent run reasoner --dry-run -- "review design"` のように
Profileの解決結果を先頭に表示します。Profile選択元 (`cli` / `env` / `default`) と、
`--model` / `--effort` / 環境変数で適用されたoverrideも表示します。後続のコマンドは
agentとeffortに応じて変わります。

```text
# Resolved profile: reasoner (source: cli)
# Resolved agent: codex
# Resolved model: gpt-5.6-sol
# Resolved effort: high
codex exec --model gpt-5.6-sol -c "model_reasoning_effort=\"high\"" "review design"
```

Profileが環境変数や `default_profile` から解決され、CLIで `--effort` を上書きした場合も、
同じ解決結果を表示できます。overrideされた項目は `# Overrides:` に示します。

```bash
CAGENT_PROFILE=reasoner cagent run --dry-run --effort xhigh -- "review design"
```

```text
# Resolved profile: reasoner (source: env)
# Resolved agent: codex
# Resolved model: gpt-5.6-sol
# Resolved effort: xhigh
# Overrides: effort=cli
codex exec --model gpt-5.6-sol -c "model_reasoning_effort=\"xhigh\"" "review design"
```

### Herdr mux

`mux start` は新しいpaneで対話セッションを開始し、`mux run` は新しいpaneで非対話実行
します。どちらも `<profile>` が必須です。

```bash
# Herdrの新しいpaneで対話セッションを開始
cagent mux start reviewer

# Herdrの新しいpaneで1回実行
cagent mux run reasoner -- "このIssueを調査して"

# Herdrを起動せず、pane操作とagent commandの計画だけを表示
cagent --dry-run mux run reviewer -- "この変更をレビューして"
```

Herdrのdry-runは次の操作を表示し、`herdr pane current`、`split`、`run`を実際には呼び
ません。

```text
# Herdr dry-run command sequence:
No Herdr command was invoked.
herdr pane current --current
herdr pane split --pane <current-pane> --direction right --cwd <cwd>
herdr pane run <created-pane> <agent-command>
Pane IDs shown in this plan are placeholders, not resource IDs.
```

通常の `mux start/run` が成功した場合でも、cagentが観測するのはpaneへのagent commandの
dispatchまでです。coding-agent taskの完了は観測せず、結果の `task_completed` は常に
`false` です。

### 設定・環境の診断

`doctor` は設定ファイル、agentの実行ファイル、provider、`default_profile`、各Profileの
agent/model、multiplexerを確認します。`--refresh` を付けるとproviderのmodel一覧を
更新してから確認します。

```bash
cagent doctor
cagent doctor --refresh
cagent doctor --json
```

### Profileとmodelの一覧

`cagent profiles` は設定済みのProfileと、agent / model / effortを表示します。
外部CLIは起動しません。`*` は `default_profile` を示します。

```bash
cagent profiles
```

```text
PROFILE      AGENT       MODEL          EFFORT
fast         codex       gpt-5.6-luna   -
balanced *   codex       gpt-5.6-terra  -
frontier     codex       gpt-5.6-sol    high

* = default_profile
```

`cagent models` は設定済みmodelの一覧を表示しません。Profile一覧は
`cagent profiles`、providerの利用可能model一覧は `cagent models available` を使います。
`cagent models` 単体はこの案内を表示して終了します。

`models available` はprovider CLIに問い合わせて、現在利用可能なmodelを表示します。
OpenCode Goでは次のコマンドに対応しています。Codexにはprovider model discovery adapterが
ないため、Codexの利用可能modelは `cagent profiles` と設定を確認してください。

```bash
CAGENT_AGENT=opencode-go cagent models available
CAGENT_AGENT=opencode-go cagent models available --refresh

# provider CLIを起動せず、解決されるコマンドだけ確認
CAGENT_AGENT=opencode-go cagent --dry-run models available --refresh
```

## 環境変数

| Variable | 用途 |
| --- | --- |
| `CAGENT_CONFIG` | 設定ファイルのパスを上書き |
| `CAGENT_AGENT` | `models available` と `doctor` の対象agentを上書き |
| `CAGENT_PROFILE` | Profile選択を上書き |
| `CAGENT_MODEL` | 選択Profileのmodelを上書き |
| `CAGENT_EFFORT` | 選択Profileのeffortを上書き |

例えば、環境変数でProfileを切り替え、CLIからpromptだけを渡せます。

```bash
CAGENT_PROFILE=reviewer cagent run -- "環境変数で選んだProfileを使う"
CAGENT_PROFILE=reasoner CAGENT_EFFORT=high cagent run -- "設計を検討する"
```

## v0.3.xからv1.0.0への手動migration

v1.0.0では後方互換の読取りや自動変換を行いません。既存設定をバックアップし、
Profile名、agent、model、effortを手動で移してください。次のbeforeは旧形式を説明する
ための唯一の例であり、新しい設定としては使用しないでください。

```yaml
# before: v0.3.x
default_agent: codex
default_level: mid
agents:
  codex:
    bin: codex
    provider: codex
    levels:
      low:
        default_model: gpt-5.6-luna
        models: [gpt-5.6-luna]
        effort: low
      mid:
        default_model: gpt-5.6-terra
        models: [gpt-5.6-terra]
        effort: mid
      high:
        default_model: gpt-5.6-sol
        models: [gpt-5.6-sol]
        effort: high
```

```yaml
# after: v1.0.0
default_agent: codex
default_profile: reasoner
agents:
  codex:
    bin: codex
    provider: codex
    model_id_prefix: false

profiles:
  reasoner:
    agent: codex
    model: gpt-5.6-sol
    effort: high

multiplexer:
  default: herdr
  herdr:
    enabled: true
```

移行時は、各実行用途に任意のProfile名を付け、旧形式のmodel設定を
`profiles.<name>.model`へ移します。共通の既定値は `default_profile` に設定し、実行ごとに
別のProfileを使う場合はCLIまたは `CAGENT_PROFILE` で明示します。旧形式の環境変数やCLI
指定は自動変換されないため、上記の新しいProfile選択と上書き規則へ手動で置き換えて
ください。

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

CodexとOpenCode Goのモデルルーティング検証は [`validation/`](validation/) で管理します。
ここでの `--profile core` と `--profile extended` はvalidation runnerの実行モードであり、
cagentのLaunch Profileとは別の指定です。

```bash
# buildとLaunch Profileごとのmodel解決を確認（外部CLIは起動しない）
bun run validate smoke --profile core

# CodexとOpenCode GoのCLIを実際に起動（外部モデル呼び出しあり）
bun run validate smoke --profile core --live
```

ルーティングmatrixは `codex-fast`、`codex-balanced`、`codex-frontier` と、対応する
OpenCode GoのProfileで構成されています。実行結果は `validation/.artifacts/` に保存され、
Git管理しません。`--live` は外部モデル呼び出しを行うため、明示的な依頼または確認が
ある場合だけ実行してください。

## Release 事前検証

Releaseに使用するGitHub repository保護と、失敗時の復旧方針は
[`docs/releasing.md`](docs/releasing.md) を参照してください。maintainerがVersion更新PRまたは
Releaseを開始するときは [`.agents/skills/github-release/SKILL.md`](.agents/skills/github-release/SKILL.md)
を使用します。

通常CIはBun 1.3.10を使い、Linux x64 standaloneのbuild・pack、archive構造、SHA-256 checksum、
隔離smoke testを検証します。ローカルではLinux x64環境で同じ検証を次のcommandから実行できます。

```bash
bun run release:check
```

smoke testはrepository外の一時directoryで `cagent --version`、`cagent --help`、一時
`CAGENT_CONFIG`を使う `cagent config init` を実行します。生成された既定設定の
`default_profile`を使ったdry-runも確認し、実行directoryの`.env`と`bunfig.toml`が環境変数や
preloadを注入しないことも検証します。

明示したstable SemVer tagと`package.json` version、および生成済みarchiveを検証する場合は次の
commandを使用します。archiveは展開せずentry一覧を検査します。

```bash
bun run release:validate -- --tag v0.1.0
bun run release:validate -- --tag v0.1.0 \
  --archive release/cagent-v0.1.0-linux-x64.tar.gz --arch x64
```

checksum処理は後続のrelease workflowから次の形で再利用できます。

```bash
bun run release:checksum -- generate release/SHA256SUMS release/*.tar.gz
bun run release:checksum -- verify release/SHA256SUMS release
```

## Standalone release artifact

`bun run build:standalone`はLinux glibc x64 baselineとarm64向けのstandalone archiveを
`release/`に生成します。各archiveは次の固定構造です。

```text
cagent-vX.Y.Z-linux-<arch>/
  cagent
  README.md
  LICENSE
```

archiveは固定のファイル順、mtime、owner/group、gzip timestampで生成します。同じ入力と固定した
Bun toolchainではarchiveの再現性を確認できます。一方、Bun standalone binary自体の
byte-for-byte再現性は保証対象ではありません。
