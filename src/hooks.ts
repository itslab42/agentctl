import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument, YAMLMap } from "yaml";

/** Supported pre-commit hook managers, in auto-detection priority order. */
export type HookManager = "lefthook" | "husky" | "simple-git-hooks" | "raw";

/** The command the hook runs. */
export const HOOK_COMMAND = "pnpm exec agentctl check";

/** Result of configuring (or attempting to configure) a hook. */
export interface HookResult {
  /** Whether any file was written. */
  changed: boolean;
  /** The manager that was used (undefined when skipped entirely). */
  manager?: HookManager;
  /** Path(s) that were created or modified, relative-friendly absolute paths. */
  files: string[];
  /** Human-readable messages to surface to the user. */
  messages: string[];
  /** Warnings (e.g. multiple managers detected, no .git). */
  warnings: string[];
  /** True when the hook already contained the agentctl command. */
  alreadyConfigured: boolean;
  /** True when configuration was skipped (e.g. no .git and raw fallback). */
  skipped: boolean;
}

/** All managers that appear to be in use in `root`, in priority order. */
export function detectManagers(root: string): HookManager[] {
  const found: HookManager[] = [];
  if (existsSync(resolve(root, "lefthook.yml")) || existsSync(resolve(root, "lefthook.yaml"))) {
    found.push("lefthook");
  }
  if (existsSync(resolve(root, ".husky"))) {
    found.push("husky");
  }
  if (hasSimpleGitHooksKey(root)) {
    found.push("simple-git-hooks");
  }
  return found;
}

function hasSimpleGitHooksKey(root: string): boolean {
  const pkgPath = resolve(root, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(pkg, "simple-git-hooks");
  } catch {
    return false;
  }
}

/**
 * Resolve which manager to use given an optional forced manager and the set of
 * detected managers. Returns the chosen manager plus warnings for any
 * additional detected managers that were not chosen.
 */
export function resolveManager(
  forced: HookManager | undefined,
  detected: HookManager[]
): { manager: HookManager; warnings: string[] } {
  if (forced) {
    return { manager: forced, warnings: [] };
  }
  if (detected.length === 0) {
    return { manager: "raw", warnings: [] };
  }
  const [chosen, ...rest] = detected;
  const warnings =
    rest.length > 0
      ? [`Multiple hook managers detected. Using "${chosen}"; ignoring: ${rest.join(", ")}.`]
      : [];
  return { manager: chosen, warnings };
}

/**
 * Configure a pre-commit hook that runs `agentctl check`.
 *
 * Detects the hook manager in use (unless `forced` is provided), then writes or
 * appends the appropriate configuration. Never duplicates an existing entry.
 */
export async function setupHooks(root: string, forced?: HookManager): Promise<HookResult> {
  const detected = detectManagers(root);
  const { manager, warnings } = resolveManager(forced, detected);

  switch (manager) {
    case "lefthook":
      return withWarnings(await setupLefthook(root), warnings);
    case "husky":
      return withWarnings(await setupHusky(root), warnings);
    case "simple-git-hooks":
      return withWarnings(await setupSimpleGitHooks(root), warnings);
    case "raw":
      return withWarnings(await setupRawGitHook(root), warnings);
  }
}

function withWarnings(result: HookResult, warnings: string[]): HookResult {
  return { ...result, warnings: [...warnings, ...result.warnings] };
}

function emptyResult(manager: HookManager): HookResult {
  return {
    changed: false,
    manager,
    files: [],
    messages: [],
    warnings: [],
    alreadyConfigured: false,
    skipped: false
  };
}

// --- lefthook ---

async function setupLefthook(root: string): Promise<HookResult> {
  const result = emptyResult("lefthook");
  const path = existsSync(resolve(root, "lefthook.yaml"))
    ? resolve(root, "lefthook.yaml")
    : resolve(root, "lefthook.yml");

  let existing = "";
  if (existsSync(path)) {
    existing = await readFile(path, "utf8");
  }

  const doc = parseDocument(existing);

  // Navigate/create pre-commit.commands
  let preCommit = doc.get("pre-commit") as YAMLMap | undefined;
  if (!(preCommit instanceof YAMLMap)) {
    preCommit = new YAMLMap();
    doc.set("pre-commit", preCommit);
  }
  let commands = preCommit.get("commands") as YAMLMap | undefined;
  if (!(commands instanceof YAMLMap)) {
    commands = new YAMLMap();
    preCommit.set("commands", commands);
  }

  // Dedup: any command whose `run` already invokes `agentctl check`?
  for (const item of commands.items) {
    const value = item.value as YAMLMap | undefined;
    const run = value instanceof YAMLMap ? value.get("run") : undefined;
    if (typeof run === "string" && /agentctl\s+check/.test(run)) {
      result.alreadyConfigured = true;
      result.messages.push(`pre-commit hook already runs agentctl check (${displayName(path)})`);
      return result;
    }
  }

  const job = new YAMLMap();
  job.set("run", HOOK_COMMAND);
  commands.set("agentctl", job);

  await writeFile(path, doc.toString(), "utf8");
  result.changed = true;
  result.files.push(path);
  result.messages.push(`Added agentctl check to ${displayName(path)} pre-commit`);
  return result;
}

// --- husky ---

async function setupHusky(root: string): Promise<HookResult> {
  const result = emptyResult("husky");
  const huskyDir = resolve(root, ".husky");
  const path = resolve(huskyDir, "pre-commit");

  let existing = "";
  if (existsSync(path)) {
    existing = await readFile(path, "utf8");
  }

  if (containsHookCommand(existing)) {
    result.alreadyConfigured = true;
    result.messages.push("pre-commit hook already runs agentctl check (.husky/pre-commit)");
    return result;
  }

  await mkdir(huskyDir, { recursive: true });
  const next = appendLine(existing, HOOK_COMMAND);
  await writeFile(path, next, "utf8");
  await chmod(path, 0o755);
  result.changed = true;
  result.files.push(path);
  result.messages.push("Added agentctl check to .husky/pre-commit");
  return result;
}

// --- simple-git-hooks ---

async function setupSimpleGitHooks(root: string): Promise<HookResult> {
  const result = emptyResult("simple-git-hooks");
  const pkgPath = resolve(root, "package.json");

  if (!existsSync(pkgPath)) {
    result.warnings.push("simple-git-hooks selected but no package.json found. Skipping.");
    result.skipped = true;
    return result;
  }

  const raw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const hooks =
    typeof pkg["simple-git-hooks"] === "object" && pkg["simple-git-hooks"] !== null
      ? (pkg["simple-git-hooks"] as Record<string, unknown>)
      : {};

  const existingPreCommit = hooks["pre-commit"];
  if (typeof existingPreCommit === "string" && /agentctl\s+check/.test(existingPreCommit)) {
    result.alreadyConfigured = true;
    result.messages.push("pre-commit hook already runs agentctl check (package.json)");
    return result;
  }

  // Preserve any existing pre-commit command by chaining with &&.
  hooks["pre-commit"] =
    typeof existingPreCommit === "string" && existingPreCommit.length > 0
      ? `${existingPreCommit} && ${HOOK_COMMAND}`
      : HOOK_COMMAND;
  pkg["simple-git-hooks"] = hooks;

  const indent = detectJsonIndent(raw);
  const trailingNewline = raw.endsWith("\n") ? "\n" : "";
  await writeFile(pkgPath, JSON.stringify(pkg, null, indent) + trailingNewline, "utf8");
  result.changed = true;
  result.files.push(pkgPath);
  result.messages.push("Added agentctl check to simple-git-hooks pre-commit (package.json)");
  result.messages.push(
    "Run your simple-git-hooks install step to apply (e.g. npx simple-git-hooks)."
  );
  return result;
}

// --- raw git hook ---

async function setupRawGitHook(root: string): Promise<HookResult> {
  const result = emptyResult("raw");
  const gitDir = resolve(root, ".git");

  if (!existsSync(gitDir)) {
    result.skipped = true;
    result.warnings.push(
      "No .git directory found. Skipping hook setup. Initialize git first, then re-run."
    );
    return result;
  }

  const hooksDir = resolve(gitDir, "hooks");
  const path = resolve(hooksDir, "pre-commit");

  let existing = "";
  if (existsSync(path)) {
    existing = await readFile(path, "utf8");
  }

  if (containsHookCommand(existing)) {
    result.alreadyConfigured = true;
    result.messages.push("pre-commit hook already runs agentctl check (.git/hooks/pre-commit)");
    return result;
  }

  await mkdir(hooksDir, { recursive: true });
  const next =
    existing.length > 0 ? appendLine(existing, HOOK_COMMAND) : `#!/bin/sh\n${HOOK_COMMAND}\n`;
  await writeFile(path, next, "utf8");
  await chmod(path, 0o755);
  result.changed = true;
  result.files.push(path);
  result.messages.push("Added agentctl check to .git/hooks/pre-commit");
  result.messages.push(
    "Tip: consider a hook manager like lefthook for shareable, versioned hooks."
  );
  return result;
}

// --- helpers ---

function containsHookCommand(content: string): boolean {
  return /agentctl\s+check/.test(content);
}

function appendLine(existing: string, line: string): string {
  if (existing.length === 0) return `${line}\n`;
  return existing.endsWith("\n") ? `${existing}${line}\n` : `${existing}\n${line}\n`;
}

function detectJsonIndent(raw: string): number {
  const match = raw.match(/\n([ \t]+)"/);
  if (!match) return 2;
  const ws = match[1];
  if (ws.includes("\t")) return 2; // JSON.stringify with tab not represented as number; fall back to 2
  return ws.length;
}

function displayName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}
