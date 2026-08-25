import { stringify } from "yaml";
import { Permissions } from "../permissions";
import { McpConfig } from "../mcp";

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

/** Renders `.kiro/mcp.json` — same MCP standard format as Cursor. */
export function renderKiroMcp(mcp: McpConfig): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(mcp.servers)) {
    const entry: Record<string, unknown> = {};
    if (server.transport === "stdio") {
      entry.command = server.command;
      if (server.args && server.args.length > 0) entry.args = server.args;
    } else {
      entry.url = server.url;
    }
    if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
    mcpServers[name] = entry;
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}
