# agentctl

[![CI](https://github.com/itslab42/agentctl/actions/workflows/ci.yaml/badge.svg)](https://github.com/itslab42/agentctl/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/@lab42/agentctl)](https://www.npmjs.com/package/@lab42/agentctl)
[![license](https://img.shields.io/npm/l/@lab42/agentctl)](./LICENSE)
[![Socket Badge](https://badge.socket.dev/npm/package/@lab42/agentctl)](https://badge.socket.dev/npm/package/@lab42/agentctl)

Single source of truth for AI coding-agent permissions. Define once in `.ai/`, generate configs for **Claude Code**, **Codex CLI**, **OpenCode**, **Cursor**, and **Kiro**.

## Quick Start

```bash
# Try it instantly (no install)
npx @lab42/agentctl@latest init
npx @lab42/agentctl@latest sync
```

```bash
# Or add as a dev dependency for the team
pnpm add -D @lab42/agentctl
pnpm exec agentctl init
pnpm exec agentctl sync
```

Or reverse-import from existing configs:

```bash
npx @lab42/agentctl@latest scan   # detect .claude/, .codex/, .cursor/, .kiro/, .opencode/ and import
```

## Commands

| Command                                       | Description                                           |
| --------------------------------------------- | ----------------------------------------------------- |
| `agentctl init`                               | Scaffold `.ai/config.yaml` and `.ai/permissions.yaml` |
| `agentctl sync`                               | Generate runtime config files from `.ai/`             |
| `agentctl validate`                           | Validate source files without generating              |
| `agentctl check`                              | Report drift without writing (exit 1 if drifted)      |
| `agentctl diff`                               | Unified diff of what `sync` would change              |
| `agentctl status`                             | One-line sync summary per runtime                     |
| `agentctl scan`                               | Reverse-import existing runtime configs into `.ai/`   |
| `agentctl allow <pattern...>`                 | Add glob patterns to the allow list                   |
| `agentctl deny <pattern...>`                  | Add glob patterns to the deny list                    |
| `agentctl remove --allow/--deny <pattern...>` | Remove patterns from a list                           |

All commands support `--color` / `--no-color`. Mutation commands (`allow`, `deny`, `remove`) support `--dry-run` and `--sync`.

## How It Works

```text
.ai/config.yaml         ← runtimes, project name, settings
.ai/permissions.yaml    ← shell + filesystem permissions (deny_over_allow)
.ai/mcp.yaml            ← MCP server declarations (optional)
        │
        ▼  agentctl sync
┌───────────────────────────────────────────┐
│  .claude/settings.json                    │
│  .codex/config.toml + hooks/             │
│  .cursor/rules/agentctl-permissions/      │
│  .kiro/settings/permissions.yaml          │
│  .opencode/opencode.json                  │
│  .cursor/mcp.json  .kiro/mcp.json        │
└───────────────────────────────────────────┘
```

Config flows one direction. Generated files are never read back as input.

## Status Example

```
claude     ✓ in sync
codex      ✗ out of sync (.codex/config.toml)
cursor     ✓ in sync
kiro       ✓ in sync
opencode   – not configured
```

Exits 0 if all in sync, 1 if drift detected — useful for CI.

## MCP Configuration

Declare MCP servers once in `.ai/mcp.yaml`:

```yaml
servers:
  my-server:
    transport: stdio
    command: npx
    args: ["-y", "my-mcp-server"]
    env:
      API_KEY: "${API_KEY}"
```

Then `agentctl sync` renders the correct format for each runtime that supports MCP.

## Feature Matrix

| Feature                | Claude | Codex    | OpenCode | Cursor | Kiro |
| ---------------------- | ------ | -------- | -------- | ------ | ---- |
| Shell allow/deny       | ✓      | ✓ (hook) | ✓        | ✓      | ✓    |
| Filesystem permissions | ✓      | ✓ (hook) | ✓        | ✓      | ✓    |
| MCP servers            | ✓      | ✗¹       | ✓        | ✓      | ✓    |
| Configurable settings  | ✓²     | ✓³       | —        | —      | —    |
| Instructions sync      | ✓      | ✓        | ✓        | ✓      | ✓    |

¹ Codex CLI does not support MCP server configuration.
² Claude settings: `alwaysThinkingEnabled`, `cleanupPeriodDays`, `disableTelemetry`.
³ Codex settings: `notifyOnDeny` (log to stderr when hook blocks a command).

### How filesystem enforcement works per runtime

- **Claude**: Native `Edit`/`Write` permission entries in settings.json.
- **Codex**: The generated Python hook detects file-writing shell commands (cp, mv, rm, tee, >, etc.) and in-place edit commands (sed -i, perl -ip, patch) and blocks them when the corresponding filesystem permission is set to `deny`.
- **OpenCode**: Native `edit`/`write` permission fields in opencode.json.
- **Cursor**: Filesystem permissions rendered in the MDC rule file.
- **Kiro**: `fs_read`/`fs_write` rules in permissions.yaml.

## Development

```bash
pnpm install
pnpm check        # format + lint + typecheck + test
pnpm build
```

- **Test runner**: Node.js built-in (`node --test`)
- **Linter/Formatter**: OXLint + OxFmt
- **Build**: `tsc` → `dist/`, stubs copy, then `oxc-minify`

## License

[Apache-2.0](./LICENSE)
