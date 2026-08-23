# agentctl

`agentctl` keeps AI coding-agent configuration in one runtime-neutral `.ai/` directory and generates settings for Claude Code, Codex CLI, and OpenCode.

## Install

```bash
pnpm add -D @lab42/agentctl@next
pnpm exec agentctl sync
```

## Commands

```bash
pnpm exec agentctl validate
pnpm exec agentctl sync
pnpm exec agentctl check
pnpm exec agentctl diff
```

Run commands from the target project directory. `sync` is the only command that writes generated files. `check` and `diff` only compare against the configuration generated in memory.

## Source files

```text
.ai/config.yaml
.ai/permissions.yaml
```

`config.yaml` controls which runtimes are enabled and the paths to the source files. `permissions.yaml` is runtime-neutral, with `deny_over_allow` precedence. Generated files are deliberately never read as an input policy source.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The Codex adapter uses `approval_policy` and `sandbox_mode` for general execution, plus a generated Python PreToolUse deny hook. The hook is generated from the canonical deny patterns and should not be edited directly.
