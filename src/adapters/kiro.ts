import { stringify, parse as yamlParse } from "yaml";
import { Permissions, PermissionValue, GENERATED_MARKER } from "../permissions";
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

function renderPermissions(permissions: Permissions): string {
  const rules: KiroRule[] = [];

  rules.push({ capability: "fs_read", effect: "allow", match: ["**"] });
  rules.push({ capability: "fs_write", effect: permissions.filesystem.write, match: ["**"] });

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

  const output = stringify({ rules }, { lineWidth: 120 });
  const formatted = output
    .replace(/\n  - capability:/g, "\n\n  - capability:")
    .replace("rules:\n\n", "rules:\n");
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
