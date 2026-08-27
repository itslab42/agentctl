---
title: Home
layout: default
nav_order: 1
---

# agentctl

{: .fs-9 }

Single source of truth for AI coding-agent configuration.
{: .fs-6 .fw-300 }

Define your permissions, MCP servers, and instructions once in a runtime-neutral
`.ai/` directory. Run `agentctl sync` to generate the correct config for **Claude
Code**, **Codex CLI**, **OpenCode**, **Cursor**, and **Kiro** — no more keeping
five settings files in step by hand.

[Get started](getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/itslab42/agentctl){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## Try it in ten seconds

```bash
npx @lab42/agentctl@latest init
npx @lab42/agentctl@latest sync
```

Already have `.claude/`, `.cursor/`, `.kiro/`, `.codex/`, or `.opencode/` configs?
Import them instead:

```bash
npx @lab42/agentctl@latest scan
```

## How it works

Config flows in one direction. You edit the files in `.ai/`; `agentctl` renders
the runtime-specific files. Generated files are never read back as input.

```text
.ai/config.yaml         ← runtimes, project name, sync settings
.ai/permissions.yaml    ← shell + filesystem permissions (deny_over_allow)
.ai/mcp.yaml            ← MCP server declarations (optional)
.ai/instructions.md     ← shared agent instructions (optional)
        │
        ▼  agentctl sync
┌───────────────────────────────────────────┐
│  .claude/settings.json                    │
│  .codex/config.toml + hooks/             │
│  .cursor/rules/  .cursor/mcp.json         │
│  .kiro/settings/permissions.yaml          │
│  .kiro/mcp.json                          │
│  .opencode/opencode.json                  │
└───────────────────────────────────────────┘
```

## Why

- **One place to edit.** Permissions, MCP servers, and instructions live in `.ai/`,
  not scattered across five runtime formats.
- **Deny-over-allow, everywhere.** A single permission model is translated into each
  runtime's semantics, so a deny in one place is a deny everywhere.
- **Drift detection for CI.** `agentctl check` exits non-zero when generated files
  fall out of sync, so a workflow step can fail the build.
- **Editor autocomplete.** JSON Schemas give the `.ai/` files completion, validation,
  and hover docs in VS Code and JetBrains.

## Next steps

- [Getting started](getting-started) — install, initialize, and sync.
- [Commands](commands) — the full CLI reference.
- [Configuration](configuration) — the `.ai/` file formats.
- [Integrations](integrations) — npx, CI, MCP, and editor schemas.

---

_agentctl is published as [`@lab42/agentctl`](https://www.npmjs.com/package/@lab42/agentctl)
under the Apache-2.0 license._
