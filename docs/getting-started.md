---
title: Getting started
layout: default
nav_order: 2
---

# Getting started

{: .no_toc }

1. TOC
   {:toc}

---

## Requirements

- Node.js ≥ 18

That's it. agentctl ships with a single runtime dependency and runs anywhere Node does.

## Install

The fastest way to try it is with `npx` — no install required:

```bash
npx @lab42/agentctl@latest init
npx @lab42/agentctl@latest sync
```

To pin it for your team, add it as a dev dependency:

```bash
pnpm add -D @lab42/agentctl
pnpm exec agentctl init
pnpm exec agentctl sync
```

(`npm` and `yarn` work too — use the equivalent `npx` / `exec` invocation.)

## Initialize

`agentctl init` scaffolds the `.ai/` directory:

```bash
agentctl init
```

This creates:

- `.ai/config.yaml` — which runtimes to generate for, project name, sync toggles
- `.ai/permissions.yaml` — shell and filesystem permissions
- `.ai/instructions.md` — shared agent instructions

By default, `init` also adds the generated paths to `.gitignore`. Useful flags:

| Flag                                     | Effect                                              |
| ---------------------------------------- | --------------------------------------------------- |
| `--preset <readonly\|standard\|trusted>` | Start from a predefined permission set              |
| `--list-presets`                         | Print the available presets and exit                |
| `--no-gitignore`                         | Skip updating `.gitignore`                          |
| `--with-hooks`                           | Set up a pre-commit hook that runs `agentctl check` |

## Enable the runtimes you use

Open `.ai/config.yaml` and flip on the runtimes you want:

```yaml
runtimes:
  claude:
    enabled: true
  cursor:
    enabled: true
  kiro:
    enabled: false
  codex:
    enabled: false
  opencode:
    enabled: false
```

See [Configuration](configuration) for the full file format.

## Sync

Generate the runtime configs from `.ai/`:

```bash
agentctl sync
```

Re-run `sync` any time you change a file in `.ai/`. To keep it running while you
edit, use watch mode:

```bash
agentctl sync --watch
```

## Verify

- `agentctl check` — reports drift and **exits 1** if any generated file is out of
  sync. This is the command to run in CI.
- `agentctl status` — a one-line summary per runtime.
- `agentctl diff` — a unified diff of exactly what `sync` would change.

## Importing existing configs

Already configured one or more runtimes by hand? Reverse-import them into `.ai/`:

```bash
agentctl scan
```

`scan` detects `.claude/`, `.codex/`, `.cursor/`, `.kiro/`, and `.opencode/`
configurations and consolidates them into your `.ai/` source. Use `--dry-run` to
preview, or `--force` to overwrite an existing `.ai/`.

## Next

- [Commands](commands) — every command and its flags.
- [Integrations](integrations) — CI, MCP, and editor autocomplete.
