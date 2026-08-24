# AgentCtl

Single source of truth for AI coding-agent configuration

## Important Rules

- You must not downgrade a package just because it solves a problem.
- Always Use top-level `gh` and `pnpm` commands such as `gh view <id>` wherever possible.
- If a top-level command is available, then avoid using sub-commands such as `gh run <sub_command>` or `pnpm run <sub_command>`.

## Testing instructions

- Run `pnpm test` to run every check defined for this app.
- Fix any test or type errors until the whole suite is green.
- To focus on one step, add the Vitest pattern: `pnpm test -t "<test name>"`.
- After moving files or changing imports, run `pnpm lint` and `pnpm format:check` to be sure OXC and TypeScript rules still pass.
- Add or update tests for the code you change, even if nobody asked.

## Commit instructions

- Title format: `type(scope?): subject`
- Always run `pnpm lint`, `pnpm format:check` and `pnpm test` before committing.
- Never use yourself as co-author

## Context Navigation (Graphify)

### Code Query Rule

- Always first query `graphify-out/graph.json` or `graphify-out/wiki/index.md` to understand code structure and connections
- only read raw code files when editing or when the first layer don't have the answer

### When to rebuild the graph

- After structural changes (new modules, major refactors)
- Headless: `graphify update .` (only processes modified files)
- Skill: `/graphify . --update` (same behavior, runs through the skill — also accepts `--obsidian` to refresh the vault)
- The graph is persistent — NO need to rebuild every session

### Do NOT

- Don't manually modify files inside `graphify-out/`
- Don't re-read the entire codebase if the graph already has the information
