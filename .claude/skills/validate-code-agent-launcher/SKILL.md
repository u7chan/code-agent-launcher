---
name: validate-code-agent-launcher
description: Run the repository-local validation workflow for code-agent-launcher. Use when asked to validate cagent routing, build the local CLI, run the Codex smoke test, collect a validation report, or prepare a validation PR.
---

# Validate Code Agent Launcher

Run the deterministic validation runner. Do not reimplement its build, model-resolution, or report logic in prompts.

## Codex smoke

1. Inspect the worktree and explain existing changes before validation.
2. Run `bun run validate smoke --profile core` to build `dist/index.js` and verify routing for all levels.
3. Before an external model call, state that `--live` starts Codex three times: `low`, `mid`, and `high`.
4. Run `bun run validate smoke --profile core --live` only after the user explicitly requests live validation or confirms the planned calls.
5. Report the generated directory below `validation/.artifacts/` and distinguish routing from backend attestation.

The Codex routing matrix is fixed in `validation/config/matrix.yaml`:

- `low`: `gpt-5.6-luna`
- `mid`: `gpt-5.6-terra`
- `high`: `gpt-5.6-sol`

Treat `backend_attestation: unobservable` as an unknown state, not a successful provider-side model verification.

## Validation PRs

When asked for a validation PR, require a clean worktree before the formal run. Commit the tested change first, run validation, then commit the report separately. Do not commit files below `validation/.artifacts/`.
