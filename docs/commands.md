---
title: Commands
layout: default
nav_order: 3
---

# Command reference

{: .no_toc }

1. TOC
   {:toc}

---

All commands accept the global flags `--color` and `--no-color`. Run
`agentctl --version` to print the installed version.

## Source lifecycle

### `agentctl init`

Scaffold the `.ai/` directory (`config.yaml`, `permissions.yaml`, `instructions.md`).

| Flag                                     | Effect                                               |
| ---------------------------------------- | ---------------------------------------------------- |
| `--preset <readonly\|standard\|trusted>` | Start from a predefined permission set               |
| `--list-presets`                         | List available presets and exit                      |
| `--no-gitignore`                         | Do not touch `.gitignore`                            |
| `--with-hooks`                           | Configure a pre-commit hook running `agentctl check` |

### `agentctl validate`

Parse and validate the `.ai/` files without generating anything. Reports the file,
line, and a fix hint on error.

### `agentctl sync`

Generate all enabled runtime config files from `.ai/`.

| Flag      | Effect                                                |
| --------- | ----------------------------------------------------- |
| `--watch` | Re-sync automatically whenever an `.ai/` file changes |

## Inspecting drift

### `agentctl check`

Report drift **without writing**. Exits `1` if any generated file is out of sync —
the command to run in CI.

### `agentctl diff`

Print a unified diff of exactly what `sync` would change.

### `agentctl status`

Print a one-line sync summary per runtime. Exits `1` if drift is detected.

```text
claude     ✓ in sync
codex      ✗ out of sync (.codex/config.toml)
cursor     ✓ in sync
kiro       ✓ in sync
opencode   – not configured
```

## Editing permissions

Mutation commands support `--dry-run` (preview only) and `--sync` (run `sync`
immediately after the change).

### `agentctl allow <pattern...>`

Add one or more glob patterns to the shell allow list.

### `agentctl deny <pattern...>`

Add one or more glob patterns to the shell deny list.

### `agentctl add <pattern...>`

Alias-style helper for adding patterns to a list.

### `agentctl remove --allow|--deny <pattern...>`

Remove patterns from the allow or deny list.

```bash
agentctl deny "rm -rf *" --sync
agentctl allow "git *" --dry-run
agentctl remove --deny "curl *"
```

## Understanding decisions

### `agentctl explain <command>`

Show how a shell command is evaluated under `deny_over_allow`: whether it is
allowed, denied, or asks, and which pattern matched.

```bash
agentctl explain "git push origin main"
```

### `agentctl audit`

Check whether commands resolve to the **same** permission decision across every
enabled runtime, and flag divergences by severity (critical / warning / info).
Useful for catching cases where one runtime's semantics differ from another's.

## Importing

### `agentctl scan`

Detect existing `.claude/`, `.codex/`, `.cursor/`, `.kiro/`, and `.opencode/`
configurations and reverse-import them into `.ai/`.

| Flag        | Effect                                 |
| ----------- | -------------------------------------- |
| `--dry-run` | Preview the import without writing     |
| `--force`   | Overwrite an existing `.ai/` directory |

## Quick index

| Command                  | Purpose                         |
| ------------------------ | ------------------------------- |
| `init`                   | Scaffold `.ai/`                 |
| `validate`               | Validate `.ai/` files           |
| `sync`                   | Generate runtime configs        |
| `check`                  | Report drift (exit 1 on drift)  |
| `diff`                   | Unified diff of pending changes |
| `status`                 | Per-runtime sync summary        |
| `scan`                   | Reverse-import existing configs |
| `allow` / `deny` / `add` | Add permission patterns         |
| `remove`                 | Remove permission patterns      |
| `explain`                | Explain a command's decision    |
| `audit`                  | Cross-runtime consistency check |
