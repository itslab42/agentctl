# AgentCtl

Single source of truth for AI coding-agent configuration. Keeps a runtime-neutral `.ai/` directory and generates settings for Claude Code, Codex CLI, OpenCode, and Kiro.

## Project Overview

- **Package**: `@lab42/agentctl` (npm, Apache-2.0)
- **Language**: TypeScript (CommonJS output)
- **Runtime**: Node.js ≥ 18
- **Package manager**: pnpm 11+
- **Test runner**: Node.js built-in test runner (`node --test`) — NOT Vitest
- **Linter/Formatter**: OXLint + OxFmt (not ESLint/Prettier)
- **Build**: `tsc` → `dist/`, stubs copy, then `oxc-minify`

## Architecture

```
.ai/config.yaml          ← source of truth (runtimes, project name, settings)
.ai/permissions.yaml     ← runtime-neutral permissions (deny_over_allow)
src/config.ts            ← parses & validates config.yaml
src/permissions.ts       ← parses & validates permissions.yaml
src/cli.ts              ← CLI entry point (init, sync, check, validate, diff, status)
src/adapters/claude.ts   ← renders .claude/settings.json
src/adapters/codex.ts    ← renders .codex/config.toml + hooks/permission-policy.py
src/adapters/opencode.ts ← renders .opencode/opencode.json
src/adapters/kiro.ts     ← renders .kiro/settings/permissions.yaml
```

- Config flows one direction: `.ai/` → adapters → generated files.
- Generated files are never read back as input.
- Permissions use `deny_over_allow` precedence exclusively.

## Important Rules

- You must not downgrade a package just because it solves a problem.
- Always use top-level `gh` and `pnpm` commands such as `gh view <id>` wherever possible.
- If a top-level command is available, then avoid using sub-commands such as `gh run <sub_command>` or `pnpm run <sub_command>`.
- Never edit generated files (`.claude/`, `.codex/`, `.opencode/`, `.kiro/settings/permissions.yaml`) directly — edit the `.ai/` source then run `agentctl sync`.
- Adapters must remain pure functions: take `Permissions` (and optional settings), return a string. No I/O.

## CLI Commands

```bash
agentctl init      # scaffold .ai/ directory
agentctl validate  # check .ai/ files parse correctly
agentctl sync      # generate all enabled runtime configs
agentctl check     # report drift (exit 1 if out of sync)
agentctl diff      # unified diff of pending changes
agentctl status    # one-line sync summary per runtime (exit 1 if drift)
agentctl --version # print version
```

## Testing Instructions

- Run `pnpm test` to run every check (compiles with `tsconfig.tests.json` into `dist-test/`, then runs `node --test`).
- Fix any test or type errors until the whole suite is green.
- Tests live in `tests/*.test.ts` — use `node:test` and `node:assert` (no external test framework).
- After moving files or changing imports, run `pnpm lint` and `pnpm format:check` to be sure OXC and TypeScript rules still pass.
- Add or update tests for the code you change, even if nobody asked.
- Full pre-commit check: `pnpm check` (runs format:check → lint → typecheck → test).

## Adding a New Adapter

1. Create `src/adapters/<name>.ts` exporting a pure render function.
2. Wire it into `src/cli.ts` inside the `expected()` function.
3. Add the runtime key to `AgentctlConfig['runtimes']` in `src/config.ts`.
4. Add a test file `tests/<name>.test.ts`.
5. Update `src/stubs/config.yaml` if the runtime should appear in the init scaffold.
6. Rebuild the graphify graph: `graphify update .`

## Commit Instructions

- Title format: `type(scope?): subject`
- Always do atomic commits.
- Always run `pnpm lint`, `pnpm format:check` and `pnpm test` before committing.
- Never use yourself as co-author.

## Context Navigation (Graphify)

### Code Query Rule

- Always first query `graphify-out/graph.json` or `graphify-out/wiki/index.md` to understand code structure and connections.
- Only read raw code files when editing or when the first layer doesn't have the answer.

### When to Rebuild the Graph

- After structural changes (new modules, major refactors).
- Headless: `graphify update .` (only processes modified files).
- Skill: `/graphify . --update` (same behavior, runs through the skill — also accepts `--obsidian` to refresh the vault).
- The graph is persistent — NO need to rebuild every session.

### Do NOT

- Don't manually modify files inside `graphify-out/`.
- Don't re-read the entire codebase if the graph already has the information.
