---
name: github-submit-change
description: Create Git branches, English prefixed commits, and GitHub pull requests for code-agent-launcher. Use when asked to name a branch, commit changes or PR feedback, or open a PR.
---

# GitHub Submit Change

Apply these conventions while performing only the Git operations requested by the user.

## Branch names

Use `<type>/<description>` or `<type>/issue-<number>-<description>` when an Issue is known.

- Types: `feature`, `fix`, `docs`, `refactor`, `test`, `chore`
- Write lowercase kebab-case.
- Keep the description short and specific.

Examples: `feature/add-model-filter`, `fix/issue-123-config-loading`.

## Commit messages

Write the message in English as `<prefix>: <summary>`.

- `feat`: new behavior
- `fix`: bug fix
- `docs`: documentation only
- `refactor`: behavior-preserving code change
- `test`: tests only
- `chore`: maintenance
- `build`: build or dependency changes
- `ci`: CI changes
- `fb`: PR review feedback

Use `fb` instead of the change-type prefix when the commit specifically addresses PR review feedback. Use an imperative, lowercase summary without a trailing period. Examples: `feat: add model filtering`, `fb: handle an empty model list`.

## Pull request body

Use the following template. Remove sections that do not apply. Use `Closes #123` only when the PR fully resolves the Issue; otherwise use `Refs #123`.

```markdown
## Issues

- Closes #123

## Why

Explain why the change is needed.

## Summary

Summarize the resulting behavior.

## Changes

- List the main changes.

## Verification

- `command` — passed
```

## Guardrails

- Do not commit or push directly to `main`.
- Stage only changes that belong to the current task.
- Do not use force push, amend, rebase, merge, or release operations unless explicitly requested.
- Run the repository-required checks before opening the PR and report only checks actually run.
- Stop after the requested operation; a commit-only request does not authorize push or PR creation.
