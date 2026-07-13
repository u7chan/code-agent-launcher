# code-agent-launcher

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
version: 2
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

## ローカル検証

Codex向けの検証設定は [`validation/`](validation/) で管理します。

```bash
# テストビルドとCodexモデルのルーティングを確認
bun run validate smoke --profile core

# Codex CLIも実際に起動
bun run validate smoke --profile core --live
```

Codexのモデル対応は `low=gpt-5.6-luna`、`mid=gpt-5.6-terra`、`high=gpt-5.6-sol` です。実行結果は `validation/.artifacts/` に保存され、Git管理しません。

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
