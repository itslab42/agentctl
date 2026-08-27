---
title: Integrations
layout: default
nav_order: 5
---

# Integrations

{: .no_toc }

1. TOC
   {:toc}

---

## npx (zero install)

Run agentctl without adding it to your project:

```bash
npx @lab42/agentctl@latest init
npx @lab42/agentctl@latest sync
npx @lab42/agentctl@latest check
```

Pin a version for reproducibility: `npx @lab42/agentctl@0.5.0 ...`.

## Continuous integration

`agentctl check` exits non-zero when generated runtime files have drifted from
`.ai/`. Run it as a step to fail the build when someone edits a generated file by
hand or forgets to re-sync.

```yaml
# .github/workflows/agentctl.yml
name: agentctl
on: [push, pull_request]

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Check for config drift
        run: npx @lab42/agentctl@latest check
```

`agentctl status` works the same way if you prefer a per-runtime summary in the log.

> **Note**
> A dedicated reusable GitHub Action (`uses: lab42/agentctl-action@v1`) is on the
> roadmap but not yet published. Until it ships, use the `npx ... check` step
> above — it does the same job.

## MCP servers

Declare [Model Context Protocol](https://modelcontextprotocol.io) servers once in
`.ai/mcp.yaml` and let `sync` render the correct format for each runtime that
supports MCP (for example `.cursor/mcp.json` and `.kiro/mcp.json`).

```yaml
servers:
  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
```

Enable it with `sync.mcp: true` and `files.mcp: .ai/mcp.yaml` in your
`config.yaml`. See [Configuration](configuration#aimcpyaml) for the full format.

## Editor autocomplete

agentctl publishes JSON Schemas for its three `.ai/` files:

| File                   | Schema                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `.ai/config.yaml`      | [config.schema.json](https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/config.schema.json)           |
| `.ai/permissions.yaml` | [permissions.schema.json](https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/permissions.schema.json) |
| `.ai/mcp.yaml`         | [mcp.schema.json](https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/mcp.schema.json)                 |

### In-file reference (works today)

The scaffolded stubs include a `yaml-language-server` comment on the first line, so
editors with the YAML language server resolve the schema immediately:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/config.schema.json
```

This gives you autocomplete, inline validation, and hover documentation in VS Code
(via the Red Hat YAML extension) and JetBrains IDEs — no extra setup.

### SchemaStore (automatic detection)

A pull request to register these schemas with
[SchemaStore](https://www.schemastore.org/) is **pending**. Once merged, editors
will detect `.ai/config.yaml`, `.ai/permissions.yaml`, and `.ai/mcp.yaml`
automatically — you won't even need the in-file comment.

## Supported runtimes

`sync` currently generates configuration for:

- **Claude Code** — `.claude/settings.json`
- **Codex CLI** — `.codex/config.toml` (plus a permission-policy hook)
- **Cursor** — `.cursor/rules/` and `.cursor/mcp.json`
- **Kiro** — `.kiro/settings/permissions.yaml` and `.kiro/mcp.json`
- **OpenCode** — `.opencode/opencode.json`
