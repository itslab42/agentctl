#!/usr/bin/env node
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { loadSource } from "./config";
import { getUserConfigDir } from "./user-config";
import { parse } from "yaml";
import { parsePermissionsOverlay } from "./permissions";
import { unifiedDiff, colorize } from "./diff";
import { color, setForceColor } from "./color";
import { addPattern, mutatePermissions, removePattern } from "./mutate";
import { adapters } from "./adapter";
import { scan } from "./scan";
import {
  resolveForRuntime,
  renderClaudeInstructions,
  renderCodexInstructions,
  renderCursorInstructions,
  renderKiroInstructions,
  renderOpenCodeInstructions
} from "./instructions";
import { presets, renderPreset, listPresetNames } from "./presets";
import { evaluate, formatForRuntime } from "./explain";
import { audit, generateTestCommands, AuditResult, AuditSummary, AuditOptions } from "./audit";
import { suggestCommand, formatError } from "./errors";
import { setupHooks, HookManager } from "./hooks";

interface GeneratedFile {
  path: string;
  content: string;
  executable?: boolean;
  runtime: string;
}

function expected(root: string, source: Awaited<ReturnType<typeof loadSource>>): GeneratedFile[] {
  if (!source.config.sync.permissions) return [];
  const files: GeneratedFile[] = [];
  const mcpEnabled = source.config.sync.mcp && source.mcp;

  for (const adapter of adapters) {
    const runtimeName = adapter.name as keyof typeof source.config.runtimes;
    if (!source.config.runtimes[runtimeName].enabled) continue;

    const rendered = adapter.render(source.permissions, {
      claude: runtimeName === "claude" ? source.config.claude : undefined,
      codex: runtimeName === "codex" ? source.config.codex : undefined,
      mcp: mcpEnabled ? source.mcp : undefined
    });

    for (const file of rendered) {
      files.push({
        runtime: adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1),
        path: resolve(root, file.path),
        content: file.content,
        executable: file.executable
      });
    }
  }

  // --- Instruction files ---
  if (source.config.sync.instructions && source.instructions) {
    if (source.config.runtimes.claude.enabled) {
      const content = resolveForRuntime(source.instructions, "claude");
      files.push({
        runtime: "Claude",
        path: resolve(root, "CLAUDE.md"),
        content: renderClaudeInstructions(content)
      });
    }
    if (source.config.runtimes.codex.enabled) {
      const content = resolveForRuntime(source.instructions, "codex");
      files.push({
        runtime: "Codex",
        path: resolve(root, "AGENTS.md"),
        content: renderCodexInstructions(content)
      });
    }
    if (source.config.runtimes.cursor.enabled) {
      const content = resolveForRuntime(source.instructions, "cursor");
      files.push({
        runtime: "Cursor",
        path: resolve(root, ".cursor/rules/agentctl-instructions/RULE.md"),
        content: renderCursorInstructions(content)
      });
    }
    if (source.config.runtimes.kiro.enabled) {
      const content = resolveForRuntime(source.instructions, "kiro");
      files.push({
        runtime: "Kiro",
        path: resolve(root, ".kiro/steering/agentctl-instructions.md"),
        content: renderKiroInstructions(content)
      });
    }
    if (source.config.runtimes.opencode.enabled) {
      const content = resolveForRuntime(source.instructions, "opencode");
      files.push({
        runtime: "OpenCode",
        path: resolve(root, "AGENTS.md"),
        content: renderOpenCodeInstructions(content)
      });
    }
  }

  return files;
}

/**
 * Reads a file as UTF-8 text when it is available.
 *
 * @param path - The file path to read
 * @returns The file contents, or `undefined` when the file cannot be read
 */
async function current(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Extracts the value of a `--env <value>` flag from a list of args, if present.
 * Returns undefined when the flag is absent so env auto-detection can take over.
 */
function envFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--env");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/**
 * Derives inheritance options (`--refresh`, `--offline`, `--no-remote`) from
 * the CLI argument list for use with policy `extends` resolution.
 */
function inheritFlags(args: string[]): {
  refresh: boolean;
  offline: boolean;
  noRemote: boolean;
  warn: (message: string) => void;
} {
  return {
    refresh: args.includes("--refresh"),
    offline: args.includes("--offline"),
    noRemote: args.includes("--no-remote"),
    warn: (message: string) => console.warn(color.cyan(`⚠ ${message}`))
  };
}

/**
 * Validates all environment-specific permission overlays located beside the base permissions file.
 *
 * @param root - Project root directory
 * @param permissionsRelPath - Project-relative path to the base permissions file
 * @throws If an overlay contains invalid YAML or does not match the expected schema
 */
async function validateOverlays(root: string, permissionsRelPath: string): Promise<void> {
  const basePath = resolve(root, permissionsRelPath);
  const dir = dirname(basePath);
  const baseFile = basename(basePath);
  const match = baseFile.match(/^(.*)(\.ya?ml)$/);
  if (!match) return;
  const [, stem, ext] = match;
  const overlayRe = new RegExp(
    `^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[^.]+${ext.replace(".", "\\.")}$`
  );

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === baseFile || !overlayRe.test(entry)) continue;
    const overlayPath = resolve(dir, entry);
    let raw: unknown;
    try {
      raw = parse(await readFile(overlayPath, "utf8"));
    } catch {
      throw new Error(
        formatError({
          message: `Invalid YAML in ${entry}`,
          file: overlayPath,
          hint: "Fix the YAML syntax error"
        })
      );
    }
    try {
      parsePermissionsOverlay(raw);
    } catch (error) {
      throw new Error(
        formatError({
          message: (error as Error).message,
          file: overlayPath,
          hint: `Check your ${entry} overlay against the expected schema`
        })
      );
    }
  }
}

/**
 * Formats a path relative to the project root when possible.
 *
 * @param root - The project root used as the path reference
 * @param path - The path to format
 * @returns The project-relative path, or the original path when the relative path is empty
 */
function display(root: string, path: string): string {
  return relative(root, path) || path;
}

async function projectName(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      name?: unknown;
    };
    if (typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;
  } catch {
    // fall through
  }
  return basename(root);
}

/** Paths managed by agentctl for each runtime. */
const runtimeGitignorePaths: Record<string, string[]> = {
  claude: [".claude/", "CLAUDE.md"],
  codex: [".codex/", "AGENTS.md"],
  cursor: [
    ".cursor/rules/agentctl-permissions/",
    ".cursor/rules/agentctl-instructions/",
    ".cursor/mcp.json"
  ],
  kiro: [
    ".kiro/settings/permissions.yaml",
    ".kiro/mcp.json",
    ".kiro/steering/agentctl-instructions.md"
  ],
  opencode: [".opencode/", "AGENTS.md"]
};

/**
 * Determines which paths should be gitignored based on the config YAML,
 * then appends missing entries to .gitignore.
 */
async function updateGitignore(root: string, configYaml: string): Promise<void> {
  // Parse which runtimes are enabled from the config we just wrote
  const { parse } = await import("yaml");
  const parsed = parse(configYaml) as { runtimes?: Record<string, { enabled?: boolean }> };
  const runtimes = parsed.runtimes ?? {};

  const paths = new Set<string>();
  // Cached inherited policies should never be committed.
  paths.add(".ai/.cache/");
  for (const [name, cfg] of Object.entries(runtimes)) {
    if (cfg.enabled && name in runtimeGitignorePaths) {
      for (const p of runtimeGitignorePaths[name]) paths.add(p);
    }
  }

  if (paths.size === 0) return;

  const gitignorePath = resolve(root, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    // File doesn't exist — will create it
  }

  const existingLines = new Set(existing.split("\n").map((l) => l.trim()));
  const toAdd = [...paths].filter((p) => !existingLines.has(p));

  if (toAdd.length === 0) return;

  const block = `\n# Generated by agentctl — do not edit directly\n${toAdd.join("\n")}\n`;
  const content =
    existing.length > 0
      ? existing.endsWith("\n")
        ? existing + block
        : existing + "\n" + block
      : block.trimStart();
  await writeFile(gitignorePath, content, "utf8");
  console.log(`   Updated .gitignore with ${toAdd.length} path(s)`);
}

/**
 * Detect if agentctl is being run via npx (or similar one-off runner).
 * Heuristic: the package is not installed in the project's node_modules.
 */
function isRunViaNpx(root: string): boolean {
  return !existsSync(resolve(root, "node_modules", "@lab42", "agentctl"));
}

/**
 * Initializes project-level or user-level agent-runtime configuration.
 *
 * Supports permission presets, optional pre-commit hooks, and Git ignore updates.
 * Refuses to overwrite an existing configuration directory.
 *
 * @param root - The project root directory.
 */
async function runInit(root: string): Promise<void> {
  const args = process.argv.slice(3);

  // --list-presets: show available presets and exit
  if (args.includes("--list-presets")) {
    console.log("Available permission presets:\n");
    for (const preset of Object.values(presets)) {
      console.log(`  ${preset.name.padEnd(12)} ${preset.description}`);
    }
    console.log("\nUsage: agentctl init --preset <name>");
    return;
  }

  // --global: scaffold user-level ~/.ai/ instead of project .ai/
  const isGlobal = args.includes("--global");

  if (isGlobal) {
    const globalDir = getUserConfigDir();
    if (existsSync(globalDir)) {
      console.error(
        `❌ ${globalDir} already exists. Remove it first if you want to re-initialize.`
      );
      process.exitCode = 1;
      return;
    }
    const stubsDir = resolve(__dirname, "stubs");
    const permissions = await readFile(resolve(stubsDir, "global-permissions.yaml"), "utf8");
    await mkdir(globalDir, { recursive: true });
    await writeFile(resolve(globalDir, "permissions.yaml"), permissions, "utf8");
    console.log(`✅ Initialized ${globalDir}/permissions.yaml`);
    console.log("   This baseline applies to all projects unless they set inherit: false.");
    return;
  }

  const aiDir = resolve(root, ".ai");
  if (existsSync(aiDir)) {
    console.error("❌ .ai/ already exists. Remove it first if you want to re-initialize.");
    process.exitCode = 1;
    return;
  }

  // Parse --preset flag
  const presetIdx = args.indexOf("--preset");
  let presetName: string | undefined;
  if (presetIdx !== -1) {
    presetName = args[presetIdx + 1];
    if (!presetName || !listPresetNames().includes(presetName)) {
      console.error(
        `❌ Unknown preset "${presetName ?? ""}". Available: ${listPresetNames().join(", ")}`
      );
      process.exitCode = 2;
      return;
    }
  }

  // Parse --with-hooks / --hook-manager flags
  const withHooks = args.includes("--with-hooks");
  const validManagers: HookManager[] = ["lefthook", "husky", "simple-git-hooks", "raw"];
  const hookManagerIdx = args.indexOf("--hook-manager");
  let hookManager: HookManager | undefined;
  if (hookManagerIdx !== -1) {
    const value = args[hookManagerIdx + 1];
    if (!value || !validManagers.includes(value as HookManager)) {
      console.error(
        `❌ Unknown hook manager "${value ?? ""}". Available: ${validManagers.join(", ")}`
      );
      process.exitCode = 2;
      return;
    }
    hookManager = value as HookManager;
  }

  const stubsDir = resolve(__dirname, "stubs");
  const name = await projectName(root);
  const config = (await readFile(resolve(stubsDir, "config.yaml"), "utf8")).replace(
    "__PROJECT_NAME__",
    name
  );

  // Use preset permissions if specified, otherwise use the stub
  const permissions = presetName
    ? renderPreset(presets[presetName])
    : await readFile(resolve(stubsDir, "permissions.yaml"), "utf8");

  await mkdir(aiDir, { recursive: true });
  await writeFile(resolve(aiDir, "config.yaml"), config, "utf8");
  await writeFile(resolve(aiDir, "permissions.yaml"), permissions, "utf8");
  await writeFile(
    resolve(aiDir, "instructions.md"),
    await readFile(resolve(stubsDir, "instructions.md"), "utf8"),
    "utf8"
  );

  const presetMsg = presetName ? ` (preset: ${presetName})` : "";
  console.log(
    `✅ Initialized .ai/config.yaml, .ai/permissions.yaml${presetMsg}, and .ai/instructions.md`
  );
  console.log("   Edit them, then run: agentctl sync");

  // Update .gitignore unless --no-gitignore
  if (!args.includes("--no-gitignore")) {
    await updateGitignore(root, config);
  }

  // Set up pre-commit hook when requested (--with-hooks, or --hook-manager implies it)
  if (withHooks || hookManager) {
    const result = await setupHooks(root, hookManager);
    for (const warning of result.warnings) {
      console.log(`⚠ ${warning}`);
    }
    for (const message of result.messages) {
      const prefix = result.changed ? "✅" : "ℹ";
      console.log(`${prefix} ${message}`);
    }
    if (result.skipped && result.warnings.length === 0 && result.messages.length === 0) {
      console.log("ℹ Hook setup skipped.");
    }
  }

  // Suggest adding as devDependency when running via npx
  if (isRunViaNpx(root)) {
    console.log(
      "\n💡 Tip: add agentctl as a dev dependency so your team can run it too:\n   pnpm add -D @lab42/agentctl"
    );
  }
}

async function runScan(root: string): Promise<void> {
  const args = process.argv.slice(3);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  const aiDir = resolve(root, ".ai");
  if (existsSync(aiDir) && !force && !dryRun) {
    console.error("❌ .ai/ already exists. Use --force to overwrite or --dry-run to preview.");
    process.exitCode = 1;
    return;
  }

  const result = await scan(root);

  if (result.detected.length === 0) {
    console.log("No runtime configurations detected.");
    return;
  }

  // Print summary of detected runtimes
  console.log("Detected runtimes:");
  for (const runtime of result.detected) {
    const parts: string[] = [`shell: ${runtime.shell}`];
    if (runtime.allowPatterns.length > 0)
      parts.push(`${runtime.allowPatterns.length} allow patterns`);
    if (runtime.denyPatterns.length > 0) parts.push(`${runtime.denyPatterns.length} deny patterns`);
    console.log(`  ${runtime.path.padEnd(40)} → ${parts.join(", ")}`);
  }

  // Print warnings about generated files
  if (result.warnings.length > 0) {
    console.log("");
    for (const warning of result.warnings) {
      console.log(`⚠ Warning: ${warning}. Scanning it is redundant.`);
    }
  }

  // Print conflicts
  if (result.conflicts.length > 0) {
    console.log("");
    for (const conflict of result.conflicts) {
      const details = conflict.runtimes.map((r) => `${r.name} uses "${r.value}"`).join(", ");
      console.log(`⚠ Conflict: ${details}. Defaulted to "${conflict.resolved}".`);
    }
  }

  // Substitute project name
  const name = await projectName(root);
  const configYaml = result.configYaml.replace("__PROJECT_NAME__", name);

  if (dryRun) {
    console.log("\n--- .ai/config.yaml ---");
    console.log(configYaml);
    console.log("--- .ai/permissions.yaml ---");
    console.log(result.permissionsYaml);
    return;
  }

  // Write files
  await mkdir(aiDir, { recursive: true });
  await writeFile(resolve(aiDir, "config.yaml"), configYaml, "utf8");
  await writeFile(resolve(aiDir, "permissions.yaml"), result.permissionsYaml, "utf8");

  console.log("\nGenerated:");
  console.log("  .ai/config.yaml");
  console.log("  .ai/permissions.yaml");
}

/**
 * Adds or removes shell permission patterns and optionally synchronizes generated runtime files.
 *
 * @param root - The project root directory.
 * @param command - The mutation command: `allow`, `deny`, `add`, or `remove`.
 */
async function runMutate(root: string, command: string): Promise<void> {
  const args = process.argv.slice(3);
  const dryRun = args.includes("--dry-run");
  const doSync = args.includes("--sync");
  const patterns = args.filter((a) => !a.startsWith("--"));

  let list: "allow" | "deny";
  let action: "add" | "remove";

  if (command === "allow") {
    list = "allow";
    action = "add";
  } else if (command === "deny") {
    list = "deny";
    action = "add";
  } else if (command === "add") {
    if (args.includes("--allow")) list = "allow";
    else if (args.includes("--deny")) list = "deny";
    else {
      console.error("❌ agentctl add requires --allow or --deny flag");
      process.exitCode = 2;
      return;
    }
    action = "add";
  } else {
    // remove
    if (args.includes("--allow")) list = "allow";
    else if (args.includes("--deny")) list = "deny";
    else {
      console.error("❌ agentctl remove requires --allow or --deny flag");
      process.exitCode = 2;
      return;
    }
    action = "remove";
  }

  // For add/remove commands, filter out the --allow/--deny flags from patterns
  const filteredPatterns =
    command === "add" || command === "remove"
      ? patterns.filter((p) => p !== "--allow" && p !== "--deny")
      : patterns;

  if (filteredPatterns.length === 0) {
    console.error(`❌ No patterns provided. Usage: agentctl ${command} "<pattern>"`);
    process.exitCode = 2;
    return;
  }

  // Determine permissions file path
  let permissionsPath: string;
  try {
    const source = await loadSource(root, { noUser: process.argv.includes("--no-user") });
    permissionsPath = source.config.files.permissions;
  } catch {
    permissionsPath = ".ai/permissions.yaml";
  }

  try {
    const result = await mutatePermissions(
      root,
      permissionsPath,
      (doc) => {
        for (const pattern of filteredPatterns) {
          if (action === "add") {
            addPattern(doc, list, pattern);
          } else {
            const removed = removePattern(doc, list, pattern);
            if (!removed) {
              console.warn(`⚠ Pattern "${pattern}" not found in shell.${list}`);
            }
          }
        }
      },
      { dryRun }
    );

    if (dryRun) {
      if (result.changed) {
        console.log(result.content);
      } else {
        console.log("No changes.");
      }
      return;
    }

    if (result.changed) {
      const verb = action === "add" ? "Added to" : "Removed from";
      for (const pattern of filteredPatterns) {
        console.log(`✓ ${verb} shell.${list}: ${pattern}`);
      }
    }
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (doSync) {
    let source: Awaited<ReturnType<typeof loadSource>>;
    try {
      source = await loadSource(root, { noUser: process.argv.includes("--no-user") });
    } catch (error) {
      console.error(`❌ Validation failed: ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
    const files = expected(root, source);
    console.log("");
    for (const file of files) {
      await mkdir(resolve(file.path, ".."), { recursive: true });
      await writeFile(file.path, file.content, "utf8");
      if (file.executable) await chmod(file.path, 0o755);
      console.log(`✓ ${file.runtime.padEnd(10)} → ${display(root, file.path)}`);
    }
    console.log("\n✅ Sync complete.");
  }
}

async function runWatch(root: string): Promise<void> {
  const { watch } = await import("node:fs");
  const aiDir = resolve(root, ".ai");
  if (!existsSync(aiDir)) {
    console.error("❌ .ai/ directory not found. Run agentctl init first.");
    process.exitCode = 1;
    return;
  }

  console.log("👀 Watching .ai/ for changes... (Ctrl+C to stop)\n");

  // Perform initial sync
  await doSync(root);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(aiDir, { recursive: true }, (_event, filename) => {
    // Ignore temp files from editors
    if (!filename || /[~.]swp$|\.tmp$|~$/.test(filename)) return;
    // Only react to yaml/md files
    if (!/\.(yaml|yml|md)$/.test(filename)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
      console.log(`[${timestamp}] .ai/${filename} changed → syncing...`);
      void doSync(root);
    }, 100);
  });

  // Clean exit on SIGINT
  process.on("SIGINT", () => {
    watcher.close();
    console.log("\n\n👋 Watch mode stopped.");
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {});
}

/**
 * Synchronizes generated runtime files with the loaded project configuration.
 */
async function doSync(root: string): Promise<void> {
  try {
    const source = await loadSource(root, {
      noUser: process.argv.includes("--no-user"),
      inherit: inheritFlags(process.argv.slice(2))
    });
    const files = expected(root, source);
    let count = 0;
    for (const file of files) {
      await mkdir(resolve(file.path, ".."), { recursive: true });
      await writeFile(file.path, file.content, "utf8");
      if (file.executable) await chmod(file.path, 0o755);
      count++;
    }
    console.log(`✓ ${count} file(s) updated`);
  } catch (error) {
    console.error(`❌ Sync error: ${(error as Error).message}`);
  }
}

/**
 * Explains how a shell command is evaluated for configured runtimes.
 *
 * @param root - The project root containing the agent runtime configuration
 * @param args - CLI arguments for the `explain` command
 */
async function runExplain(root: string, args: string[]): Promise<void> {
  // The command string is the first non-flag argument after "explain"
  const explainArgs = args.slice(args.indexOf("explain") + 1);
  const jsonOutput = explainArgs.includes("--json");
  const verbose = explainArgs.includes("--verbose");
  const runtimeIdx = explainArgs.indexOf("--runtime");
  const runtimeFilter = runtimeIdx !== -1 ? explainArgs[runtimeIdx + 1] : undefined;
  const cmd = explainArgs.find(
    (a, i) => !a.startsWith("--") && (runtimeIdx === -1 || i !== runtimeIdx + 1)
  );

  if (!cmd) {
    console.error(
      "Usage: agentctl explain <shell-command> [--json] [--runtime <name>] [--verbose]"
    );
    process.exitCode = 2;
    return;
  }

  let source: Awaited<ReturnType<typeof loadSource>>;
  try {
    source = await loadSource(root, {
      env: envFlag(explainArgs),
      noUser: args.includes("--no-user"),
      inherit: inheritFlags(args)
    });
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const coreResult = evaluate(cmd, source.permissions);

  // Determine which runtimes to show
  const runtimeNames = ["claude", "codex", "cursor", "kiro", "opencode"] as const;
  let targetRuntimes: string[];
  if (runtimeFilter) {
    if (!runtimeNames.includes(runtimeFilter as (typeof runtimeNames)[number])) {
      console.error(`❌ Unknown runtime "${runtimeFilter}". Available: ${runtimeNames.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    targetRuntimes = [runtimeFilter];
  } else {
    // Show all enabled runtimes, or all if none enabled
    const enabled = runtimeNames.filter(
      (r) => source.config.runtimes[r as keyof typeof source.config.runtimes].enabled
    );
    targetRuntimes = enabled.length > 0 ? enabled : [...runtimeNames];
  }

  const results = targetRuntimes.map((r) => formatForRuntime(coreResult, r));

  if (jsonOutput) {
    const output = {
      command: cmd,
      results: results.map((r) => ({
        runtime: r.runtime,
        decision: r.decision,
        reason: r.reason,
        matchedPattern: r.matchedPattern ?? null,
        matchedList: r.matchedList ?? null
      }))
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Human-readable output
  console.log(`\nCommand: ${color.bold(cmd)}\n`);

  if (verbose) {
    console.log(color.dim("  Deny patterns:"));
    if (source.permissions.shell.deny.length === 0) {
      console.log(color.dim("    (none)"));
    } else {
      for (const p of source.permissions.shell.deny) {
        console.log(color.dim(`    - ${p}`));
      }
    }
    console.log(color.dim("  Allow patterns:"));
    if (source.permissions.shell.allow.length === 0) {
      console.log(color.dim("    (none)"));
    } else {
      for (const p of source.permissions.shell.allow) {
        console.log(color.dim(`    - ${p}`));
      }
    }
    console.log(color.dim(`  Default: ${source.permissions.shell.default}\n`));
  }

  for (const result of results) {
    const label = result.runtime.charAt(0).toUpperCase() + result.runtime.slice(1);
    let decisionStr: string;
    if (result.decision === "allow") {
      decisionStr = color.green("ALLOW");
    } else if (result.decision === "deny") {
      decisionStr = color.red("DENY");
    } else {
      decisionStr = color.cyan("ASK");
    }
    console.log(`  ${label.padEnd(10)} → ${decisionStr}  (${result.reason})`);
  }
  console.log("");
}

/**
 * Audits permission decisions across enabled runtimes and reports divergences.
 *
 * Supports custom command files, JSON or verbose output, advisory failure handling, and environment-specific configuration.
 *
 * @param root - The project root directory
 * @param args - Command-line arguments for the audit operation
 */
async function runAudit(root: string, args: string[]): Promise<void> {
  const auditArgs = args.slice(args.indexOf("audit") + 1);
  const jsonOutput = auditArgs.includes("--json");
  const verbose = auditArgs.includes("--verbose");
  const failOnAdvisory = auditArgs.includes("--fail-on-advisory");
  const commandsIdx = auditArgs.indexOf("--commands");
  const commandsFile = commandsIdx !== -1 ? auditArgs[commandsIdx + 1] : undefined;

  let source: Awaited<ReturnType<typeof loadSource>>;
  try {
    source = await loadSource(root, {
      env: envFlag(auditArgs),
      noUser: args.includes("--no-user"),
      inherit: inheritFlags(args)
    });
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // Determine enabled runtimes
  const runtimeNames = ["claude", "codex", "cursor", "kiro", "opencode"] as const;
  const enabledRuntimes = runtimeNames.filter(
    (r) => source.config.runtimes[r as keyof typeof source.config.runtimes].enabled
  );

  // Load custom commands if provided
  let customCommands: string[] | undefined;
  if (commandsFile) {
    try {
      const content = await readFile(resolve(root, commandsFile), "utf8");
      customCommands = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    } catch (error) {
      console.error(`❌ Cannot read commands file: ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }

  const summary: AuditSummary = audit(source.permissions, [...enabledRuntimes], {
    commands: customCommands,
    failOnAdvisory
  });

  // Handle skip cases
  if (summary.skipped) {
    if (jsonOutput) {
      console.log(JSON.stringify({ skipped: summary.skipped }, null, 2));
    } else {
      console.log(`\n${summary.skipped}\n`);
    }
    return;
  }

  if (jsonOutput) {
    const output = {
      tested: summary.tested,
      consistent: summary.consistent,
      divergences: summary.divergences.map((d) => ({
        command: d.command,
        severity: d.severity,
        decisions: Object.fromEntries(
          d.decisions.map((rd) => [rd.runtime, { decision: rd.decision, pattern: rd.pattern }])
        )
      }))
    };
    console.log(JSON.stringify(output, null, 2));
    if (summary.divergences.length > 0) process.exitCode = 1;
    return;
  }

  // Human-readable output
  console.log(`\nCross-runtime permission audit`);
  console.log(`${"━".repeat(30)}\n`);
  console.log(
    `Testing ${summary.tested} patterns against ${enabledRuntimes.length} enabled runtimes...\n`
  );

  if (verbose) {
    // Show all results
    for (const result of getAllResults(source.permissions, [...enabledRuntimes], {
      commands: customCommands,
      failOnAdvisory
    })) {
      if (result.consistent) {
        const decision = result.decisions[0].decision.toUpperCase();
        console.log(
          color.green(`✓`) +
            ` "${result.command}" ${color.dim(".".repeat(Math.max(1, 40 - result.command.length)))} ${decision} across all runtimes`
        );
      } else {
        printDivergence(result);
      }
    }
  } else {
    // Show only divergences
    if (summary.divergences.length === 0) {
      console.log(color.green(`✓ All ${summary.tested} commands are consistent across runtimes.`));
    } else {
      for (const divergence of summary.divergences) {
        printDivergence(divergence);
      }
    }
  }

  console.log(
    `\nSummary: ${summary.consistent}/${summary.tested} consistent${summary.divergences.length > 0 ? `, ${color.red(`${summary.divergences.length} divergence${summary.divergences.length > 1 ? "s" : ""} found`)}` : ""}.`
  );

  if (summary.divergences.length > 0) process.exitCode = 1;
}

function printDivergence(result: AuditResult): void {
  const severityLabel =
    result.severity === "critical"
      ? color.red("CRITICAL")
      : result.severity === "warning"
        ? color.cyan("WARNING")
        : color.dim("INFO");
  console.log(`${color.red("✗")} "${result.command}"  ${severityLabel}`);
  for (const d of result.decisions) {
    const label = d.runtime.charAt(0).toUpperCase() + d.runtime.slice(1);
    let decisionStr: string;
    if (d.decision === "allow") {
      decisionStr = color.green("ALLOW");
    } else if (d.decision === "deny") {
      decisionStr = color.red("DENY");
    } else {
      decisionStr = color.cyan("ASK");
    }
    console.log(`    ${label.padEnd(10)} ${decisionStr}  (${d.reason})`);
  }
}

/**
 * Helper to get all individual audit results for verbose mode.
 */
function getAllResults(
  permissions: Parameters<typeof audit>[0],
  runtimes: string[],
  options: AuditOptions
): AuditResult[] {
  const commands = options.commands ?? generateTestCommands(permissions);
  const results: AuditResult[] = [];
  for (const command of commands) {
    const core = evaluate(command, permissions);
    const decisions = runtimes.map((runtime) => {
      const formatted = formatForRuntime(core, runtime);
      return {
        runtime,
        decision: formatted.decision,
        pattern: formatted.matchedPattern ?? null,
        reason: formatted.reason
      };
    });
    const failOnAdvisory = options.failOnAdvisory ?? false;
    const consistent =
      decisions.length <= 1 ||
      (() => {
        if (failOnAdvisory) {
          const first = decisions[0].decision;
          return decisions.every((d) => d.decision === first);
        }
        const nonCursor = decisions.filter((d) => d.runtime !== "cursor");
        if (nonCursor.length <= 1) return true;
        const first = nonCursor[0].decision;
        return nonCursor.every((d) => d.decision === first);
      })();
    results.push({ command, decisions, consistent });
  }
  return results;
}

/**
 * Runs the command-line interface and dispatches the requested operation.
 *
 * Reports invalid commands, configuration failures, and configuration drift through process exit codes.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--color")) setForceColor(true);
  else if (args.includes("--no-color")) setForceColor(false);

  // Global --no-user flag: skip user-level ~/.ai/ config merge
  const noUser = args.includes("--no-user");

  const command = args.find((a) => !a.startsWith("--"));
  if (command === "--version" || command === "-V") {
    const pkg = JSON.parse(await readFile(resolve(__dirname, "../package.json"), "utf8")) as {
      version: string;
    };
    console.log(pkg.version);
    return;
  }
  const validCommands = [
    "init",
    "sync",
    "check",
    "validate",
    "diff",
    "status",
    "scan",
    "allow",
    "deny",
    "add",
    "remove",
    "explain",
    "audit"
  ];
  if (!command || !validCommands.includes(command)) {
    if (command) {
      const suggestion = suggestCommand(command, validCommands);
      const msg = suggestion
        ? formatError({
            message: `Unknown command "${command}"`,
            hint: `Did you mean "${suggestion}"?`
          })
        : formatError({
            message: `Unknown command "${command}"`,
            hint: `Available commands: ${validCommands.join(", ")}`
          });
      console.error(msg);
    } else {
      console.error(
        "Usage: agentctl <init|sync|check|validate|diff|status|scan|allow|deny|add|remove|explain|audit|--version>"
      );
    }
    process.exitCode = 2;
    return;
  }
  const root = process.cwd();
  if (command === "init") {
    await runInit(root);
    return;
  }
  if (command === "scan") {
    await runScan(root);
    return;
  }
  if (command === "allow" || command === "deny" || command === "add" || command === "remove") {
    await runMutate(root, command);
    return;
  }
  if (command === "explain") {
    await runExplain(root, args);
    return;
  }
  if (command === "audit") {
    await runAudit(root, args);
    return;
  }
  let source: Awaited<ReturnType<typeof loadSource>>;
  try {
    source = await loadSource(root, {
      env: envFlag(args),
      noUser,
      inherit: inheritFlags(args)
    });
  } catch (error) {
    console.error(`❌ Validation failed: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  for (const warning of source.inheritanceWarnings ?? []) {
    console.warn(color.cyan(`⚠ ${warning}`));
  }
  if (command === "validate") {
    try {
      await validateOverlays(root, source.config.files.permissions);
    } catch (error) {
      console.error(`❌ Validation failed: ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
    if (source.inheritedFrom) {
      console.log(color.dim(`   inherits from: ${source.inheritedFrom}`));
    }
    console.log("✅ .ai configuration is valid.");
    return;
  }
  const files = expected(root, source);

  if (command === "status") {
    console.log(color.dim(`environment: ${source.env}\n`));
    if (source.inheritedFrom) {
      const { classifyTarget, cacheStatus } = await import("./inherit");
      let freshness = "";
      if (classifyTarget(source.inheritedFrom) === "https") {
        const status = await cacheStatus(source.inheritedFrom, {
          cacheDir: resolve(root, ".ai/.cache")
        });
        if (!status.cached) {
          freshness = " (not cached)";
        } else {
          const age = status.fetchedAt
            ? `${Math.round((Date.now() - status.fetchedAt) / 60000)}m ago`
            : "unknown";
          freshness = status.fresh ? ` (cached ${age}, fresh)` : ` (cached ${age}, stale)`;
        }
      }
      console.log(color.dim(`extends: ${source.inheritedFrom}${freshness}\n`));
    }
    let drift = false;
    for (const adapter of adapters) {
      const name = adapter.name as keyof typeof source.config.runtimes;
      const enabled = source.config.runtimes[name].enabled;
      if (!enabled) {
        console.log(color.dim(`${adapter.name.padEnd(10)} – not configured`));
        continue;
      }
      const runtimeFiles = files.filter((f) => f.runtime.toLowerCase() === adapter.name);
      const diffs: string[] = [];
      for (const file of runtimeFiles) {
        const before = await current(file.path);
        const differs =
          before !== file.content ||
          (file.executable &&
            (!existsSync(file.path) || ((await stat(file.path)).mode & 0o111) === 0));
        if (differs) diffs.push(display(root, file.path));
      }
      if (diffs.length > 0) {
        drift = true;
        console.log(color.red(`${adapter.name.padEnd(10)} ✗ out of sync (${diffs.join(", ")})`));
      } else {
        console.log(color.green(`${adapter.name.padEnd(10)} ✓ in sync`));
      }
    }
    if (drift) process.exitCode = 1;
    return;
  }

  if (command === "sync") {
    const watchMode = process.argv.slice(2).includes("--watch");
    if (watchMode) {
      await runWatch(root);
      return;
    }
    console.log("🤖 Syncing agent configurations...\n");
    if (source.env !== "local") {
      console.log(color.dim(`   environment: ${source.env} (overlay applied)\n`));
    }
    for (const file of files) {
      await mkdir(resolve(file.path, ".."), { recursive: true });
      await writeFile(file.path, file.content, "utf8");
      if (file.executable) await chmod(file.path, 0o755);
      console.log(`✓ ${file.runtime.padEnd(10)} → ${display(root, file.path)}`);
    }
    console.log("\n✅ Agent configuration sync complete.");
    return;
  }
  let drift = false;
  if (command === "check") console.log("🔍 Checking agent configurations...\n");
  for (const file of files) {
    const before = await current(file.path);
    const differs =
      before !== file.content ||
      (file.executable && (!existsSync(file.path) || ((await stat(file.path)).mode & 0o111) === 0));
    if (differs) {
      drift = true;
      if (command === "check") console.log(color.red(`✗ Out of sync: ${display(root, file.path)}`));
      else
        process.stdout.write(colorize(unifiedDiff(display(root, file.path), before, file.content)));
    } else if (command === "check")
      console.log(color.green(`✓ In sync: ${display(root, file.path)}`));
  }
  if (command === "check")
    console.log(
      drift
        ? "\n❌ Agent configurations are out of sync."
        : "\n✅ Agent configurations are in sync."
    );
  if (drift) process.exitCode = 1;
}

void main();
