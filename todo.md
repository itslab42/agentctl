# Todo

## Bugs (fix first)

- [x] Codex adapter: `shell.default === "allow"` falls through to wrong branch — maps to `never` instead of `auto`
- [x] Codex adapter: `shell.allow` patterns are never written to the hook — Claude and Codex have different effective permissions from identical source
- [x] Claude adapter: `alwaysThinkingEnabled`, `cleanupPeriodDays`, telemetry are hardcoded — should be configurable with sensible defaults

## Commands

- [ ] `agentctl add/allow/deny <pattern>` — append shell patterns to `permissions.yaml` from the CLI
- [ ] `agentctl status` — one-line summary of which runtimes are enabled and whether they're in sync
- [ ] `agentctl scan` — detect existing `.claude/`, `.cursor/` etc. and generate `.ai/` from what's already there
- [ ] `agentctl explain <command>` — show what each runtime would do with a given shell command and which rule fires
- [ ] `agentctl audit` — cross-runtime consistency checker, report where runtimes diverge in effective policy

## Init improvements

- [ ] Permission presets (`--preset readonly|standard|trusted`) — don't scaffold blank YAML
- [ ] Offer to update `.gitignore` interactively instead of just printing a tip

## Adapters & runtimes

- [ ] Cursor adapter (`.cursor/mcp.json` + cursor settings) — larger user base than Codex and OpenCode combined
- [ ] Extend Codex and OpenCode adapters to be on par with Claude
- [ ] MCP server config management — `.ai/mcp.yaml` → per-runtime MCP config files
- [ ] Instruction file management — `.ai/instructions.md` → `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`

## Config model

- [ ] Richer permissions — network access, env var access, MCP server permissions, path-level read vs write
- [ ] Layered config — `~/.ai/` user-level baseline that projects extend/override
- [ ] Environment profiles — `.ai/permissions.ci.yaml` overlays stricter rules when `AGENTCTL_ENV=ci`
- [ ] Policy inheritance — `extends:` a remote or shared policy URL for org-wide baselines
- [ ] Configurable Claude adapter defaults (thinkingEnabled, cleanupPeriodDays, telemetry)

## DX

- [ ] Colored diff output — `+` green, `-` red
- [ ] Better error messages — cite file, show context, suggest the fix
- [ ] Watch mode (`--watch`) — auto-run `sync` when `.ai/` files change
- [ ] Pre-commit hook out of the box — `agentctl init --with-hooks` adds `agentctl check` to lefthook

## Distribution

- [ ] JSON Schema for `.ai/config.yaml` and `.ai/permissions.yaml` — submit to SchemaStore for VS Code autocomplete
- [ ] GitHub Action (`uses: lab42/agentctl-action@v1`) — runs `agentctl check` in CI, enforces no drift
- [ ] `npx @lab42/agentctl@latest init` as primary install path in README
