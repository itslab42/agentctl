# agentctl

[![CI](https://github.com/itslab42/agentctl/actions/workflows/ci.yaml/badge.svg)](https://github.com/itslab42/agentctl/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/@lab42/agentctl)](https://www.npmjs.com/package/@lab42/agentctl)
[![license](https://img.shields.io/npm/l/@lab42/agentctl)](./LICENSE)
[![Socket Badge](https://badge.socket.dev/npm/package/@lab42/agentctl)](https://badge.socket.dev/npm/package/@lab42/agentctl)

**Define your AI coding-agent permissions once. Enforce them everywhere.**

`agentctl` is the single source of truth for what your AI coding agents are _allowed to do_. Declare shell and filesystem rules once in `.ai/` — with `deny_over_allow` precedence — and generate native configs for **Claude Code**, **Codex CLI**, **OpenCode**, **Cursor**, and **Kiro**. Deterministic, one-way, and enforceable in CI.

Unlike instruction-sync tools that only distribute prompts and rules, `agentctl` governs the guardrails: destructive shell, git, and API calls stay blocked across every runtime, from one policy.

🌐 **[itslab42.github.io/agentctl](https://itslab42.github.io/agentctl/)** · 📦 **[npm](https://www.npmjs.com/package/@lab42/agentctl)**

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

| Command                                       | Description                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `agentctl init`                               | Scaffold `.ai/config.yaml` and `.ai/permissions.yaml` (`--with-hooks` to set up a pre-commit hook) |
| `agentctl sync`                               | Generate runtime config files from `.ai/`                                                          |
| `agentctl validate`                           | Validate source files without generating                                                           |
| `agentctl check`                              | Report drift without writing (exit 1 if drifted)                                                   |
| `agentctl diff`                               | Unified diff of what `sync` would change                                                           |
| `agentctl status`                             | One-line sync summary per runtime                                                                  |
| `agentctl scan`                               | Reverse-import existing runtime configs into `.ai/`                                                |
| `agentctl explain <shell-command>`            | Show whether a command is allowed or denied, and why                                               |
| `agentctl audit`                              | Check permission consistency across enabled runtimes                                               |
| `agentctl allow <pattern...>`                 | Add glob patterns to the allow list                                                                |
| `agentctl deny <pattern...>`                  | Add glob patterns to the deny list                                                                 |
| `agentctl remove --allow/--deny <pattern...>` | Remove patterns from a list                                                                        |

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

## CI (GitHub Action)

Use [`agentctl-action`](https://github.com/itslab42/agentctl-action) to verify configs stay in sync on every push and PR. It runs `agentctl` in CI and fails the build when generated files have drifted from `.ai/`.

```yaml
# .github/workflows/ci.yaml
- uses: actions/checkout@v4
- uses: itslab42/agentctl-action@v1
  with:
    command: check # check (default), status, or audit
```

Inputs: `command`, `version`, `fail-on-advisory` (for `audit`), `working-directory`, `node-version`. See the [action README](https://github.com/itslab42/agentctl-action) for details.

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

## Policy Inheritance (`extends`)

Share a canonical security baseline across many repos. Point `extends` in `.ai/config.yaml` at a base policy — an HTTPS URL, an npm package path, or a local file — and your local `permissions.yaml` is merged on top.

```yaml
# .ai/config.yaml
extends: "https://raw.githubusercontent.com/myorg/policies/main/.ai/permissions.yaml"
# or an npm package path
# extends: "@myorg/agent-policy/permissions.yaml"
# or a local file
# extends: "../shared/.ai/permissions.yaml"

project:
  name: my-app
runtimes:
  claude:
    enabled: true
```

**Local can only tighten, never weaken the baseline:**

- `shell.deny` — union of base + local (local can add denials).
- `shell.allow` — local allows are kept only if the base also allows them (local cannot broaden).
- `filesystem` / `shell.default` — the stricter of base and local wins.

**Remote policies are cached** in `.ai/.cache/` with a 24h TTL and conditional (ETag / Last-Modified) revalidation:

- `agentctl sync --refresh` — force a re-fetch.
- `agentctl sync --offline` — use the cache only (for CI without network).
- `agentctl sync --no-remote` — disable all remote fetching (air-gapped).

**Safeguards:** only HTTPS URLs are allowed (HTTP is rejected), fetched content is validated before use, circular `extends` are detected, and nesting is capped at 3 levels. `agentctl validate` reports the inherited source; `agentctl status` shows the `extends` target and cache freshness.

## Feature Matrix

| Feature                | Claude | Codex    | OpenCode | Cursor | Kiro |
| ---------------------- | ------ | -------- | -------- | ------ | ---- |
| Shell allow/deny       | ✓      | ✓ (hook) | ✓        | ✓      | ✓    |
| Filesystem permissions | ✓      | ✓ (hook) | ✓        | ✓      | ✓    |
| MCP servers            | ✓      | ✓¹       | ✓        | ✓      | ✓    |
| Configurable settings  | ✓²     | ✓³       | —        | —      | —    |
| Instructions sync      | ✓      | ✓        | ✓        | ✓      | ✓    |

¹ Codex CLI supports MCP server configuration, but agentctl does not currently render it.
² Claude settings: `alwaysThinkingEnabled`, `cleanupPeriodDays`, `disableTelemetry`.
³ Codex settings: `notifyOnDeny` (log to stderr when hook blocks a command).

### How filesystem enforcement works per runtime

- **Claude**: Native `Edit`/`Write` permission entries in settings.json.
- **Codex**: Native sandbox mode; `workspace-write` is used only when both edit and write are allowed, otherwise the sandbox is read-only.
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
