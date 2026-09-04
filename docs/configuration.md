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

### Extended schema (v2)

Adding `version: 2` opts into a richer permission model with path-level filesystem
rules and new `network`, `env`, and `mcp` sections. Files **without** a `version`
field (or with `version: 1`) keep the v1 behavior unchanged — v2 is fully opt-in and
backwards compatible.

```yaml
version: 2
policy:
  precedence: deny_over_allow

# Path-level filesystem rules. Each of read/write is a capability block.
filesystem:
  read:
    default: allow
    deny:
      - ".env*"
      - "**/*.pem"
      - "**/secrets/**"
  write:
    default: allow
    ask:
      - "*.config.*"
      - "tsconfig.json"
    deny:
      - "package-lock.json"
      - ".git/**"

shell:
  default: ask
  allow: ["pnpm *"]
  deny: ["rm -rf *"]

network:
  default: ask
  allow:
    - "https://registry.npmjs.org/*"
    - "*://api.github.com/*"
  deny:
    - "http://*"

env:
  default: deny
  allow: ["NODE_ENV", "GITHUB_*"]
  ask: ["CI"]
  deny: ["*_TOKEN", "*_KEY"]

mcp:
  default: ask
  allow: ["filesystem:*", "postgres:query"]
  deny: ["postgres:drop_table"]
```

Every capability block (`filesystem.read`, `filesystem.write`, `network`, `env`,
`mcp`) shares the same shape and is evaluated with **deny-over-allow** precedence:

1. matches a `deny` pattern → **deny**
2. matches an `ask` pattern → **ask**
3. matches an `allow` pattern → **allow**
4. otherwise → the block's `default`

| Section            | Pattern form                       | Validation                                       |
| ------------------ | ---------------------------------- | ------------------------------------------------ |
| `filesystem.read`  | path globs                         | —                                                |
| `filesystem.write` | path globs (scalar still accepted) | —                                                |
| `network`          | URL globs                          | must start with `https://`, `http://`, or `*://` |
| `env`              | env var name globs                 | names only — no `=`                              |
| `mcp`              | `<server>:<tool>` or `<server>:*`  | must match the `server:tool` form                |

A pattern cannot appear in more than one of `allow` / `deny` / `ask` within the same
capability. When a v2 file uses `filesystem.read` / `filesystem.write` blocks, the
`default` of each is also exposed as the legacy blanket scalar so existing adapters
continue to work.

#### Runtime support

Not every runtime can enforce every capability. Where a runtime cannot, agentctl
emits an advisory comment rather than silently dropping the policy.

| Capability         | Kiro                     |
| ------------------ | ------------------------ |
| `filesystem.read`  | `fs_read` rules          |
| `filesystem.write` | `fs_write` rules         |
| `network`          | `web_search`/`web_fetch` |
| `env`              | advisory comment         |
| `mcp`              | `mcp` capability rules   |

The Kiro adapter is the reference implementation for v2. Other adapters gain support
in follow-up work.

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
