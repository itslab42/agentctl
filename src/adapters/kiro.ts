import { stringify } from "yaml";
import { Permissions } from "../permissions";

interface KiroRule {
  capability: string;
  effect: "allow" | "ask" | "deny";
  match?: string[];
  exclude?: string[];
}

/**
 * Translates agentctl's unified Permissions into Kiro CLI's
 * capability-based permissions.yaml format.
 *
 * Kiro uses a rules array where each rule has:
 *   - capability: fs_read | fs_write | filesystem | shell | web_search | web_fetch | mcp
 *   - effect: allow | ask | deny
 *   - match: optional glob patterns (paths for filesystem, commands for shell)
 *   - exclude: optional patterns that exempt matches from this rule
 *
 * Evaluation order: deny > ask > allow (most restrictive wins).
 * Deny rules ALWAYS win — they cannot be overridden by allow rules.
 */
export function renderKiro(permissions: Permissions): string {
  const rules: KiroRule[] = [];

  // --- Filesystem rules ---
  rules.push({ capability: "fs_read", effect: "allow", match: ["**"] });
  rules.push({ capability: "fs_write", effect: permissions.filesystem.write, match: ["**"] });

  // --- Shell rules ---
  // Deny patterns get their own deny rule so Kiro's "deny always wins" semantics
  // ensure they are blocked regardless of any allow rules.
  if (permissions.shell.deny.length > 0) {
    rules.push({
      capability: "shell",
      effect: "deny",
      match: permissions.shell.deny
    });
  }

  // Allow patterns get their own allow rule.
  if (permissions.shell.allow.length > 0) {
    rules.push({
      capability: "shell",
      effect: "allow",
      match: permissions.shell.allow
    });
  }

  // Default shell posture (catch-all).
  rules.push({ capability: "shell", effect: permissions.shell.default });

  const output = stringify({ rules }, { lineWidth: 120 });
  // Add a blank line between each rule entry for readability.
  return output
    .replace(/\n  - capability:/g, "\n\n  - capability:")
    .replace("rules:\n\n", "rules:\n");
}
