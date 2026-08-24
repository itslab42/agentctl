# AgentCtl

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
