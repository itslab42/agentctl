# Graph Report - agentctl  (2026-08-26)

## Corpus Check
- 16 files · ~7,692 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 115 nodes · 253 edges · 9 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `72e38aa6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- config.ts
- cli.ts
- Permissions YAML Stub
- scan.ts
- mutate.ts
- expected
- permissions.ts
- Project Instructions
- cursor.ts

## God Nodes (most connected - your core abstractions)
1. `expected()` - 17 edges
2. `main()` - 11 edges
3. `scan()` - 11 edges
4. `loadSource()` - 9 edges
5. `runMutate()` - 8 edges
6. `GENERATED_MARKER` - 8 edges
7. `Permissions` - 7 edges
8. `parseConfig()` - 6 edges
9. `parsePermissions()` - 6 edges
10. `runInit()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `expected()` --calls--> `renderCodexConfig()`  [EXTRACTED]
  src/cli.ts → src/adapters/codex.ts
- `renderCodexHook()` --indirect_call--> `globToRegexSource()`  [INFERRED]
  src/adapters/codex.ts → src/permissions.ts
- `expected()` --calls--> `renderCodexHook()`  [EXTRACTED]
  src/cli.ts → src/adapters/codex.ts
- `expected()` --calls--> `renderCursorMcp()`  [EXTRACTED]
  src/cli.ts → src/adapters/cursor.ts
- `expected()` --calls--> `renderCursorRule()`  [EXTRACTED]
  src/cli.ts → src/adapters/cursor.ts

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "config.ts"
Cohesion: 0.17
Nodes (17): AgentctlConfig, claudeDefaults, ClaudeSettings, number(), object(), parseConfig(), runtime(), string() (+9 more)

### Community 1 - "cli.ts"
Cohesion: 0.15
Nodes (22): current(), display(), GeneratedFile, main(), projectName(), runInit(), runMutate(), runScan() (+14 more)

### Community 2 - "Permissions YAML Stub"
Cohesion: 0.47
Nodes (6): Filesystem Permissions, Permission Policy, Runtime Configuration, Shell Permissions, Config YAML Stub, Permissions YAML Stub

### Community 4 - "scan.ts"
Cohesion: 0.27
Nodes (12): Conflict, isGeneratedFile(), parseClaude(), parseCodex(), parseCodexHook(), parseCursor(), parseKiro(), parseOpenCode() (+4 more)

### Community 5 - "mutate.ts"
Cohesion: 0.36
Nodes (8): addPattern(), getShellSeq(), loadDocument(), MutateOptions, mutatePermissions(), MutateResult, removePattern(), seqValues()

### Community 6 - "expected"
Cohesion: 0.17
Nodes (15): renderClaude(), KiroRule, renderKiro(), renderKiroMcp(), expected(), InstructionBlock, Instructions, loadInstructions() (+7 more)

### Community 7 - "permissions.ts"
Cohesion: 0.24
Nodes (10): renderCodexConfig(), renderCodexHook(), renderOpenCode(), asObject(), GENERATED_MARKER, globToRegexSource(), parsePermissions(), patterns() (+2 more)

### Community 8 - "Project Instructions"
Cohesion: 0.40
Nodes (4): Architecture, Build & Test, Code Style, Project Instructions

### Community 9 - "cursor.ts"
Cohesion: 0.67
Nodes (3): renderCursorMcp(), renderCursorRule(), renderMcpServers()

## Knowledge Gaps
- **17 isolated node(s):** `KiroRule`, `GeneratedFile`, `AgentctlConfig`, `Op`, `InstructionBlock` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scan()` connect `scan.ts` to `cli.ts`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `loadSource()` connect `cli.ts` to `config.ts`, `expected`, `permissions.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `GENERATED_MARKER` connect `permissions.ts` to `config.ts`, `cursor.ts`, `scan.ts`, `expected`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `KiroRule`, `GeneratedFile`, `AgentctlConfig` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `cli.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14814814814814814 - nodes in this community are weakly interconnected._