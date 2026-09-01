import { stringify, parse as yamlParse } from "yaml";
import {
  Permissions,
  PermissionValue,
  CapabilityPermissions,
  GENERATED_MARKER
} from "../permissions";
import { McpConfig } from "../mcp";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";

const PERMISSIONS_PATH = ".kiro/settings/permissions.yaml";
const MCP_PATH = ".kiro/mcp.json";
const PATHS = [PERMISSIONS_PATH, MCP_PATH];

interface KiroRule {
  capability: string;
  effect: "allow" | "ask" | "deny";
  match?: string[];
  exclude?: string[];
}

/**
 * Emit deny → ask → allow → default rules for a v2 capability block against a
 * single Kiro capability name (e.g. `fs_read`, `web_fetch`, `mcp`).
 */
function capabilityRules(name: string, cap: CapabilityPermissions): KiroRule[] {
  const rules: KiroRule[] = [];
  if (cap.deny.length > 0) rules.push({ capability: name, effect: "deny", match: [...cap.deny] });
  if (cap.ask.length > 0) rules.push({ capability: name, effect: "ask", match: [...cap.ask] });
  if (cap.allow.length > 0)
    rules.push({ capability: name, effect: "allow", match: [...cap.allow] });
  rules.push({ capability: name, effect: cap.default });
  return rules;
}

function renderPermissions(permissions: Permissions): string {
  const rules: KiroRule[] = [];

  // Filesystem read: v2 path-level rules if present, else blanket allow.
  if (permissions.filesystem.read) {
    rules.push(...capabilityRules("fs_read", permissions.filesystem.read));
  } else {
    rules.push({ capability: "fs_read", effect: "allow", match: ["**"] });
  }

  // Filesystem write: v2 path-level rules if present, else blanket scalar.
  if (permissions.filesystem.writePaths) {
    rules.push(...capabilityRules("fs_write", permissions.filesystem.writePaths));
  } else {
    rules.push({ capability: "fs_write", effect: permissions.filesystem.write, match: ["**"] });
  }

  if (permissions.shell.deny.length > 0) {
    rules.push({
      capability: "shell",
      effect: "deny",
      match: permissions.shell.deny
    });
  }

  if (permissions.shell.allow.length > 0) {
    rules.push({
      capability: "shell",
      effect: "allow",
      match: permissions.shell.allow
    });
  }

  rules.push({ capability: "shell", effect: permissions.shell.default });

  // v2: network → Kiro web_search + web_fetch capabilities.
  if (permissions.network) {
    rules.push(...capabilityRules("web_search", permissions.network));
    rules.push(...capabilityRules("web_fetch", permissions.network));
  }

  // v2: MCP tool permissions → Kiro `mcp` capability rules.
  if (permissions.mcp) {
    rules.push(...capabilityRules("mcp", permissions.mcp));
  }

  const output = stringify({ rules }, { lineWidth: 120 });
  let formatted = output
    .replace(/\n  - capability:/g, "\n\n  - capability:")
    .replace("rules:\n\n", "rules:\n");

  // v2: env vars cannot be enforced by Kiro — emit an advisory comment so the
  // policy is not silently dropped.
  if (permissions.env) {
    const allow = permissions.env.allow.length ? permissions.env.allow.join(", ") : "(none)";
    const deny = permissions.env.deny.length ? permissions.env.deny.join(", ") : "(none)";
    formatted +=
      `\n# env access is advisory in Kiro (not natively enforceable):\n` +
      `#   default: ${permissions.env.default}\n` +
      `#   allow: ${allow}\n` +
      `#   deny: ${deny}\n`;
  }

  return `# ${GENERATED_MARKER}\n${formatted}`;
}

function renderMcp(mcp: McpConfig): string {
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

function parse(raw: string): DetectedRuntime {
  const parsed = yamlParse(raw) as {
    rules?: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const rules = parsed.rules ?? [];

  let shell: PermissionValue = "ask";
  const allowPatterns: string[] = [];
  const denyPatterns: string[] = [];
  const filesystem: { edit?: PermissionValue; write?: PermissionValue } = {};

  for (const rule of rules) {
    const effect = rule.effect as PermissionValue;

    if (rule.capability === "shell") {
      const hasMatch = rule.match && rule.match.length > 0;
      const isCatchAll = !hasMatch || (rule.match!.length === 1 && rule.match![0] === "**");

      if (!hasMatch || isCatchAll) {
        shell = effect;
      } else if (effect === "deny") {
        denyPatterns.push(...rule.match!);
      } else if (effect === "allow") {
        allowPatterns.push(...rule.match!);
      }
    } else if (rule.capability === "fs_write") {
      filesystem.write = effect;
    } else if (rule.capability === "fs_read") {
      filesystem.edit = effect;
    }
  }

  return {
    name: "kiro",
    path: PERMISSIONS_PATH,
    shell,
    allowPatterns,
    denyPatterns,
    filesystem
  };
}

export const kiroAdapter: Adapter = {
  name: "kiro",
  paths: PATHS,

  render(permissions: Permissions, options?: AdapterOptions): GeneratedFile[] {
    const files: GeneratedFile[] = [
      { path: PERMISSIONS_PATH, content: renderPermissions(permissions) }
    ];
    if (options?.mcp) {
      files.push({ path: MCP_PATH, content: renderMcp(options.mcp) });
    }
    return files;
  },

  parse(raw: string, _path: string): DetectedRuntime {
    return parse(raw);
  },

  owns(path: string): boolean {
    return path === PERMISSIONS_PATH || path === MCP_PATH;
  }
};

/** @deprecated Use kiroAdapter.render() instead */
export function renderKiro(permissions: Permissions): string {
  return renderPermissions(permissions);
}

/** @deprecated Use kiroAdapter.render() instead */
export function renderKiroMcp(mcp: McpConfig): string {
  return renderMcp(mcp);
}
