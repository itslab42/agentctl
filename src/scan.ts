import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import { PermissionValue } from "./permissions";

/** A runtime config detected on disk. */
export interface DetectedRuntime {
  name: string;
  path: string;
  shell: PermissionValue;
  allowPatterns: string[];
  denyPatterns: string[];
}

/** A conflict between two runtimes on the shell default mode. */
export interface Conflict {
  field: string;
  runtimes: { name: string; value: string }[];
  resolved: string;
}

/** Result of scanning the project root. */
export interface ScanResult {
  detected: DetectedRuntime[];
  conflicts: Conflict[];
  configYaml: string;
  permissionsYaml: string;
}

/**
 * Parse `.claude/settings.json` and extract permissions.
 */
function parseClaude(raw: string): DetectedRuntime {
  const parsed = JSON.parse(raw) as {
    permissions?: { allow?: string[]; deny?: string[] };
  };
  const perms = parsed.permissions ?? {};
  const allow = (perms.allow ?? [])
    .filter((p: string) => p.startsWith("Bash(") && p.endsWith(")"))
    .map((p: string) => p.slice(5, -1));
  const deny = (perms.deny ?? [])
    .filter((p: string) => p.startsWith("Bash(") && p.endsWith(")"))
    .map((p: string) => p.slice(5, -1));

  // Claude's shell mode is "ask" by default (it prompts for each command)
  // If there are allows but no complex setup, infer "ask"
  const shell: PermissionValue = "ask";

  return {
    name: "claude",
    path: ".claude/settings.json",
    shell,
    allowPatterns: allow,
    denyPatterns: deny
  };
}

/**
 * Parse codex config. Supports both `.codex/config.toml` and top-level `codex.json`.
 */
function parseCodex(raw: string, path: string): DetectedRuntime {
  let shell: PermissionValue = "ask";
  const allowPatterns: string[] = [];
  const denyPatterns: string[] = [];

  if (path.endsWith(".toml")) {
    // Simple TOML parsing for the fields we care about
    const approvalMatch = raw.match(/approval_policy\s*=\s*"([^"]+)"/);
    if (approvalMatch) {
      const policy = approvalMatch[1];
      if (policy === "auto") shell = "allow";
      else if (policy === "never") shell = "deny";
      else shell = "ask";
    }
  } else {
    // codex.json format
    const parsed = JSON.parse(raw) as {
      approval_policy?: string;
      shell?: { allow?: string[]; deny?: string[] };
    };
    if (parsed.approval_policy === "auto") shell = "allow";
    else if (parsed.approval_policy === "never") shell = "deny";
    else shell = "ask";
    if (parsed.shell) {
      allowPatterns.push(...(parsed.shell.allow ?? []));
      denyPatterns.push(...(parsed.shell.deny ?? []));
    }
  }

  return { name: "codex", path, shell, allowPatterns, denyPatterns };
}

/**
 * Parse the codex hook script to extract allow/deny regex patterns and convert back to globs.
 */
function parseCodexHook(raw: string): { allow: string[]; deny: string[] } {
  const allow: string[] = [];
  const deny: string[] = [];

  const denyMatch = raw.match(/DENY_PATTERNS\s*=\s*\[([^\]]*)\]/s);
  if (denyMatch) {
    const patterns = denyMatch[1].match(/"([^"]+)"/g);
    if (patterns) deny.push(...patterns.map((p) => regexSourceToGlob(p.slice(1, -1))));
  }

  const allowMatch = raw.match(/ALLOW_PATTERNS\s*=\s*\[([^\]]*)\]/s);
  if (allowMatch) {
    const patterns = allowMatch[1].match(/"([^"]+)"/g);
    if (patterns) allow.push(...patterns.map((p) => regexSourceToGlob(p.slice(1, -1))));
  }

  return { allow, deny };
}

/** Convert a simple regex source (from globToRegexSource) back to a glob. */
function regexSourceToGlob(src: string): string {
  let glob = src;
  // Strip anchors
  if (glob.startsWith("^")) glob = glob.slice(1);
  if (glob.endsWith("$")) glob = glob.slice(0, -1);
  // Convert .* back to *
  glob = glob.replace(/\.\*/g, "*");
  // Unescape common characters
  glob = glob.replace(/\\([.+^${}()|[\]\\])/g, "$1");
  return glob;
}

/** Resolve the shell mode conflict. Prefer most restrictive: deny > ask > allow. */
function resolveShellConflict(values: PermissionValue[]): PermissionValue {
  if (values.includes("deny")) return "deny";
  if (values.includes("ask")) return "ask";
  return "allow";
}

/**
 * Scan a project root for known runtime config files and produce a merged `.ai/` config.
 */
export async function scan(root: string): Promise<ScanResult> {
  const detected: DetectedRuntime[] = [];

  // Detect Claude
  const claudePath = resolve(root, ".claude/settings.json");
  if (existsSync(claudePath)) {
    const raw = await readFile(claudePath, "utf8");
    detected.push(parseClaude(raw));
  }

  // Detect Codex — try .codex/config.toml first, then codex.json
  const codexTomlPath = resolve(root, ".codex/config.toml");
  const codexJsonPath = resolve(root, "codex.json");
  if (existsSync(codexTomlPath)) {
    const raw = await readFile(codexTomlPath, "utf8");
    const result = parseCodex(raw, ".codex/config.toml");
    // Also try to read the hook for patterns
    const hookPath = resolve(root, ".codex/hooks/permission-policy.py");
    if (existsSync(hookPath)) {
      const hookRaw = await readFile(hookPath, "utf8");
      const hookPatterns = parseCodexHook(hookRaw);
      result.allowPatterns.push(...hookPatterns.allow);
      result.denyPatterns.push(...hookPatterns.deny);
    }
    detected.push(result);
  } else if (existsSync(codexJsonPath)) {
    const raw = await readFile(codexJsonPath, "utf8");
    detected.push(parseCodex(raw, "codex.json"));
  }

  if (detected.length === 0) {
    return {
      detected: [],
      conflicts: [],
      configYaml: "",
      permissionsYaml: ""
    };
  }

  // Merge patterns with deduplication
  const allAllow = [...new Set(detected.flatMap((d) => d.allowPatterns))];
  const allDeny = [...new Set(detected.flatMap((d) => d.denyPatterns))];

  // Detect conflicts
  const conflicts: Conflict[] = [];
  const shellModes = detected.map((d) => d.shell);
  const uniqueModes = [...new Set(shellModes)];
  const resolvedShell = resolveShellConflict(shellModes);
  if (uniqueModes.length > 1) {
    conflicts.push({
      field: "shell.default",
      runtimes: detected.map((d) => ({ name: d.name, value: d.shell })),
      resolved: resolvedShell
    });
  }

  // Build runtimes map
  const runtimes: Record<string, { enabled: boolean }> = {
    claude: { enabled: detected.some((d) => d.name === "claude") },
    codex: { enabled: detected.some((d) => d.name === "codex") },
    kiro: { enabled: false },
    opencode: { enabled: false }
  };

  const configObj = {
    project: { name: "__PROJECT_NAME__" },
    runtimes,
    sync: { permissions: true },
    files: { permissions: ".ai/permissions.yaml" }
  };

  const permissionsObj = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: {
      default: resolvedShell,
      allow: allAllow,
      deny: allDeny
    }
  };

  const configYaml = stringify(configObj, { lineWidth: 0 });
  const permissionsYaml = stringify(permissionsObj, { lineWidth: 0 });

  return { detected, conflicts, configYaml, permissionsYaml };
}
