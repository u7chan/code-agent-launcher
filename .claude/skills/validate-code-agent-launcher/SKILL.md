---
name: validate-code-agent-launcher
description: Run the repository-local validation workflow for code-agent-launcher. Use when asked to validate cagent routing, build the local CLI, run the Codex or OpenCode smoke test, collect a validation report, or prepare a validation PR.
---

# Validate Code Agent Launcher

Run the deterministic validation runner. Do not reimplement its build, model-resolution, or report logic in prompts.

## Smoke

1. Inspect the worktree and explain existing changes before validation.
2. Run `bun run validate smoke --profile core` to build `dist/index.js` and verify routing for Codex and OpenCode.
3. Use `--agent codex` or `--agent opencode-go` to run only one agent.
4. Before an external model call, state that `--live` starts both Codex and OpenCode three times each (`low`, `mid`, `high`), or list the specific agent if `--agent` is used.
5. Run `bun run validate smoke --profile core --live` only after the user explicitly requests live validation or confirms the planned calls.
6. Report the generated directory below `validation/.artifacts/` and distinguish routing from backend attestation.

The routing matrix is fixed in `validation/config/matrix.yaml`:

| Agent | Level | Expected model |
| --- | --- | --- |
| codex | low | gpt-5.6-luna |
| codex | mid | gpt-5.6-terra |
| codex | high | gpt-5.6-sol |
| opencode-go | low | opencode-go/deepseek-v4-flash |
| opencode-go | mid | opencode-go/deepseek-v4-pro |
| opencode-go | high | opencode-go/minimax-m3 |

Treat `backend_attestation: unobservable` as an unknown state, not a successful provider-side model verification.

## Validation PRs

When asked for a validation PR, require a clean worktree before the formal run. Commit the tested change first, run validation, then commit the report separately. Do not commit files below `validation/.artifacts/`.
