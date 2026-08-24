# Graph Report - agentctl  (2026-08-25)

## Corpus Check
- 8 files · ~2,315 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 49 nodes · 95 edges · 10 communities (8 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7a7e8886`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- permissions.ts
- cli.ts
- Permissions YAML Stub
- config.ts
- parseConfig
- Permissions
- diff.ts
- loadSource
- expected
- codex.ts

## God Nodes (most connected - your core abstractions)
1. `expected()` - 7 edges
2. `main()` - 7 edges
3. `Permissions` - 6 edges
4. `parsePermissions()` - 6 edges
5. `parseConfig()` - 6 edges
6. `loadSource()` - 6 edges
7. `renderCodexHook()` - 4 edges
8. `unifiedDiff()` - 4 edges
9. `Permissions YAML Stub` - 4 edges
10. `renderKiro()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `expected()` --calls--> `renderKiro()`  [EXTRACTED]
  src/cli.ts → src/adapters/kiro.ts
- `renderCodexHook()` --indirect_call--> `globToRegexSource()`  [INFERRED]
  src/adapters/codex.ts → src/permissions.ts
- `expected()` --calls--> `renderCodexHook()`  [EXTRACTED]
  src/cli.ts → src/adapters/codex.ts
- `loadSource()` --calls--> `parsePermissions()`  [EXTRACTED]
  src/config.ts → src/permissions.ts
- `expected()` --calls--> `renderOpenCode()`  [EXTRACTED]
  src/cli.ts → src/adapters/opencode.ts

## Import Cycles
- None detected.

## Communities (10 total, 2 thin omitted)

### Community 0 - "permissions.ts"
Cohesion: 0.43
Nodes (6): asObject(), parsePermissions(), patterns(), permission(), PermissionValue, values

### Community 1 - "cli.ts"
Cohesion: 0.48
Nodes (6): current(), display(), GeneratedFile, main(), projectName(), runInit()

### Community 2 - "Permissions YAML Stub"
Cohesion: 0.47
Nodes (6): Filesystem Permissions, Permission Policy, Runtime Configuration, Shell Permissions, Config YAML Stub, Permissions YAML Stub

### Community 3 - "config.ts"
Cohesion: 0.47
Nodes (3): AgentctlConfig, claudeDefaults, ClaudeSettings

### Community 4 - "parseConfig"
Cohesion: 0.50
Nodes (5): number(), object(), parseConfig(), runtime(), string()

### Community 5 - "Permissions"
Cohesion: 0.33
Nodes (4): KiroRule, renderKiro(), renderOpenCode(), Permissions

### Community 6 - "diff.ts"
Cohesion: 0.67
Nodes (3): lcsOps(), Op, unifiedDiff()

### Community 8 - "expected"
Cohesion: 0.67
Nodes (3): renderClaude(), renderCodexConfig(), expected()

## Knowledge Gaps
- **7 isolated node(s):** `KiroRule`, `PermissionValue`, `GeneratedFile`, `AgentctlConfig`, `Op` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadSource()` connect `loadSource` to `permissions.ts`, `cli.ts`, `config.ts`, `parseConfig`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `parsePermissions()` connect `permissions.ts` to `config.ts`, `loadSource`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `unifiedDiff()` connect `diff.ts` to `cli.ts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `KiroRule`, `PermissionValue`, `GeneratedFile` to the rest of the system?**
  _7 weakly-connected nodes found - possible documentation gaps or missing edges._