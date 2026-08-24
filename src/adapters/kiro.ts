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
 *
 * Evaluation order: deny > ask > allow (most restrictive wins).
 */
export function renderKiro(permissions: Permissions): string {
  const rules: KiroRule[] = [];

  // --- Filesystem rules ---
  // Kiro uses "fs_read" (always allowed in agentctl model) and "fs_write" for edits/writes.
  rules.push({ capability: "fs_read", effect: "allow" });

  // Map filesystem.edit and filesystem.write to fs_write effect.
  // Use the more permissive of the two (edit/write both gate fs_write in Kiro).
  const fsEffect = mostPermissive(permissions.filesystem.edit, permissions.filesystem.write);
  rules.push({ capability: "fs_write", effect: fsEffect });

  // --- Shell rules ---
  // Use exclude field for deny patterns (Kiro's deny-overrides means a separate
  // deny rule would block even when the allow list matches).
  if (permissions.shell.allow.length > 0) {
    const rule: KiroRule = {
      capability: "shell",
      effect: "allow",
      match: permissions.shell.allow
    };
    if (permissions.shell.deny.length > 0) {
      rule.exclude = permissions.shell.deny;
    }
    rules.push(rule);
  } else if (permissions.shell.deny.length > 0) {
    // No allow patterns but there are deny patterns — emit standalone deny rule.
    rules.push({
      capability: "shell",
      effect: "deny",
      match: permissions.shell.deny
    });
  }

  // Default shell posture (catch-all).
  rules.push({ capability: "shell", effect: permissions.shell.default });

  return stringify({ rules }, { lineWidth: 120 });
}

function mostPermissive(
  a: "allow" | "ask" | "deny",
  b: "allow" | "ask" | "deny"
): "allow" | "ask" | "deny" {
  const order: Record<string, number> = { allow: 0, ask: 1, deny: 2 };
  return order[a] <= order[b] ? a : b;
}
