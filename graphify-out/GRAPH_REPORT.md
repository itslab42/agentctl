# Graph Report - agentctl (2026-08-24)

## Corpus Check

- Corpus is ~2,341 words - fits in a single context window. You may not need a graph.

## Summary

- 50 nodes · 97 edges · 8 communities (7 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- Permissions & Adapters
- CLI & Rendering
- Config Stubs
- Claude Adapter & Config
- Config Schema Parsing
- Kiro Adapter
- Diff Engine
- YAML File Loading

## God Nodes (most connected - your core abstractions)

1. `expected()` - 7 edges
2. `main()` - 7 edges
3. `parseConfig()` - 6 edges
4. `loadSource()` - 6 edges
5. `Permissions` - 6 edges
6. `parsePermissions()` - 6 edges
7. `renderCodexHook()` - 4 edges
8. `renderKiro()` - 4 edges
9. `unifiedDiff()` - 4 edges
10. `Permissions YAML Stub` - 4 edges

## Surprising Connections (you probably didn't know these)

- `renderCodexHook()` --indirect_call--> `globToRegexSource()` [INFERRED]
  src/adapters/codex.ts → src/permissions.ts
- `expected()` --calls--> `renderCodexHook()` [EXTRACTED]
  src/cli.ts → src/adapters/codex.ts
- `expected()` --calls--> `renderKiro()` [EXTRACTED]
  src/cli.ts → src/adapters/kiro.ts
- `main()` --calls--> `loadSource()` [EXTRACTED]
  src/cli.ts → src/config.ts
- `main()` --calls--> `unifiedDiff()` [EXTRACTED]
  src/cli.ts → src/diff.ts

## Import Cycles

- None detected.

## Communities (8 total, 1 thin omitted)

### Community 0 - "Permissions & Adapters"

Cohesion: 0.27
Nodes (9): renderCodexHook(), asObject(), globToRegexSource(), parsePermissions(), patterns(), permission(), Permissions, PermissionValue (+1 more)

### Community 1 - "CLI & Rendering"

Cohesion: 0.33
Nodes (10): renderClaude(), renderCodexConfig(), renderOpenCode(), current(), display(), expected(), GeneratedFile, main() (+2 more)

### Community 2 - "Config Stubs"

Cohesion: 0.47
Nodes (6): Filesystem Permissions, Permission Policy, Runtime Configuration, Shell Permissions, Config YAML Stub, Permissions YAML Stub

### Community 3 - "Claude Adapter & Config"

Cohesion: 0.47
Nodes (3): AgentctlConfig, claudeDefaults, ClaudeSettings

### Community 4 - "Config Schema Parsing"

Cohesion: 0.50
Nodes (5): number(), object(), parseConfig(), runtime(), string()

### Community 5 - "Kiro Adapter"

Cohesion: 0.67
Nodes (3): KiroRule, mostPermissive(), renderKiro()

### Community 6 - "Diff Engine"

Cohesion: 0.67
Nodes (3): lcsOps(), Op, unifiedDiff()

## Knowledge Gaps

- **7 isolated node(s):** `KiroRule`, `GeneratedFile`, `AgentctlConfig`, `Op`, `PermissionValue` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `loadSource()` connect `YAML File Loading` to `Permissions & Adapters`, `CLI & Rendering`, `Claude Adapter & Config`, `Config Schema Parsing`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `parsePermissions()` connect `Permissions & Adapters` to `Claude Adapter & Config`, `YAML File Loading`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `unifiedDiff()` connect `Diff Engine` to `CLI & Rendering`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `KiroRule`, `GeneratedFile`, `AgentctlConfig` to the rest of the system?**
  _7 weakly-connected nodes found - possible documentation gaps or missing edges._
