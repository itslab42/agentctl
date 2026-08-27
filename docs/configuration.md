---
title: Configuration
layout: default
nav_order: 4
---

# Configuration

{: .no_toc }

Everything agentctl generates comes from the files in `.ai/`. This page documents
each file's format.
{: .fs-5 .fw-300 }

1. TOC
   {:toc}

---

## `.ai/config.yaml`

Declares the project name, which runtimes to generate for, and what to sync.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/config.schema.json
project:
  name: my-project

runtimes:
  claude:
    enabled: true
  codex:
    enabled: false
  cursor:
    enabled: false
  kiro:
    enabled: false
  opencode:
    enabled: false

sync:
  permissions: true
  instructions: true
  mcp: false

files:
  permissions: .ai/permissions.yaml
  instructions: .ai/instructions.md
  mcp: .ai/mcp.yaml
```

| Key                       | Type    | Notes                                                                                        |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `project.name`            | string  | Used in generated file headers                                                               |
| `runtimes.<name>.enabled` | boolean | One of `claude`, `codex`, `cursor`, `kiro`, `opencode`. Omitted runtimes default to disabled |
| `sync.permissions`        | boolean | Generate permission files                                                                    |
| `sync.instructions`       | boolean | Generate instruction files (default `false`)                                                 |
| `sync.mcp`                | boolean | Generate MCP configs (default `false`)                                                       |
| `files.permissions`       | string  | Path to the permissions source                                                               |
| `files.instructions`      | string  | Path to the instructions source (optional)                                                   |
| `files.mcp`               | string  | Path to the MCP source (optional)                                                            |

An optional `claude:` block tunes Claude-specific settings
(`alwaysThinkingEnabled`, `cleanupPeriodDays`, `disableTelemetry`).

## `.ai/permissions.yaml`

Runtime-neutral permissions. agentctl resolves conflicts with **deny-over-allow**:
a matching deny always wins.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/permissions.schema.json
policy:
  precedence: deny_over_allow

filesystem:
  edit: allow
  write: allow

shell:
  default: ask
  allow:
    - "git *"
    - "pnpm *"
  deny:
    - "rm -rf *"
    - "curl *"
```

| Key                 | Values                     | Notes                              |
| ------------------- | -------------------------- | ---------------------------------- |
| `policy.precedence` | `deny_over_allow`          | The only supported precedence      |
| `filesystem.edit`   | `allow` \| `ask` \| `deny` | Editing existing files             |
| `filesystem.write`  | `allow` \| `ask` \| `deny` | Creating / writing files           |
| `shell.default`     | `allow` \| `ask` \| `deny` | Fallback for unmatched commands    |
| `shell.allow`       | list of glob patterns      | Commands to allow                  |
| `shell.deny`        | list of glob patterns      | Commands to deny (wins over allow) |

A pattern cannot appear in both `allow` and `deny` — agentctl rejects contradictory
lists.

## `.ai/mcp.yaml`

Declare [Model Context Protocol](https://modelcontextprotocol.io) servers once;
`sync` renders them into each runtime that supports MCP. Enable it by setting
`sync.mcp: true` and `files.mcp` in `config.yaml`.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/itslab42/agentctl/main/schemas/mcp.schema.json
servers:
  # Local command over stdio
  filesystem:
    transport: stdio
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "/path/to/allowed/dir"
    env:
      API_KEY: "${API_KEY}"

  # Remote server over HTTP
  my-api:
    transport: streamable-http
    url: "http://localhost:3001/mcp"
```

| Transport         | Required                             | Not allowed       |
| ----------------- | ------------------------------------ | ----------------- |
| `stdio`           | `command` (optionally `args`, `env`) | `url`             |
| `streamable-http` | `url` (optionally `env`)             | `command`, `args` |

Use `${VAR_NAME}` in `env` to reference secrets from the environment. **Do not put
real secrets in this file.**

## `.ai/instructions.md`

Free-form shared instructions for your agents. When `sync.instructions` is enabled,
agentctl renders it into each runtime's expected location (for example `CLAUDE.md`,
`AGENTS.md`, Cursor rules, and Kiro steering).

## Editor autocomplete

Each file ships with a `# yaml-language-server: $schema=...` comment so editors with
the YAML language server (VS Code's Red Hat YAML extension, JetBrains) pick up
completion, validation, and hover docs automatically. See
[Integrations](integrations#editor-autocomplete) for details and the SchemaStore
status.
