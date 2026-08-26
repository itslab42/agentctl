import { Permissions, PermissionValue, GENERATED_MARKER } from "../permissions";
import { McpConfig } from "../mcp";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";

const RULE_PATH = ".cursor/rules/agentctl-permissions/RULE.md";
const MCP_PATH = ".cursor/mcp.json";
const PATHS = [RULE_PATH, MCP_PATH];

/** Renders MCP server config as JSON for a standard mcpServers format. */
function renderMcpServers(mcp: McpConfig): Record<string, Record<string, unknown>> {
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
  return mcpServers;
}

function renderMcp(mcp: McpConfig): string {
  return `${JSON.stringify({ mcpServers: renderMcpServers(mcp) }, null, 2)}\n`;
}

function renderRule(permissions: Permissions): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push('description: "Shell and filesystem permissions enforced by agentctl"');
  lines.push("alwaysApply: true");
  lines.push("---");
  lines.push("");
  lines.push("# Permissions Policy");
  lines.push("");
  lines.push(`This rule is ${GENERATED_MARKER}.`);
  lines.push("");
  lines.push("## Filesystem");
  lines.push("");
  lines.push(`- File editing: ${permissions.filesystem.edit}`);
  lines.push(`- File creation/write: ${permissions.filesystem.write}`);
  lines.push("");
  lines.push("## Shell Commands");
  lines.push("");
  lines.push(`Default policy: ${permissions.shell.default}`);
  lines.push("");

  if (permissions.shell.deny.length > 0) {
    lines.push("### Denied (never run these)");
    lines.push("");
    for (const pattern of permissions.shell.deny) {
      lines.push(`- \`${pattern}\``);
    }
    lines.push("");
  }

  if (permissions.shell.allow.length > 0) {
    lines.push("### Allowed (safe to run without asking)");
    lines.push("");
    for (const pattern of permissions.shell.allow) {
      lines.push(`- \`${pattern}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parse(raw: string): DetectedRuntime {
  let shell: PermissionValue = "ask";
  const allowPatterns: string[] = [];
  const denyPatterns: string[] = [];
  const filesystem: { edit?: PermissionValue; write?: PermissionValue } = {};

  const defaultMatch = raw.match(/Default policy:\s*(allow|ask|deny)/);
  if (defaultMatch) {
    shell = defaultMatch[1] as PermissionValue;
  }

  const editMatch = raw.match(/- File editing:\s*(allow|ask|deny)/);
  if (editMatch) {
    filesystem.edit = editMatch[1] as PermissionValue;
  }

  const writeMatch = raw.match(/- File creation\/write:\s*(allow|ask|deny)/);
  if (writeMatch) {
    filesystem.write = writeMatch[1] as PermissionValue;
  }

  const deniedSection = raw.match(/### Denied[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/);
  if (deniedSection) {
    const patternMatches = deniedSection[1].matchAll(/- `([^`]+)`/g);
    for (const m of patternMatches) {
      denyPatterns.push(m[1]);
    }
  }

  const allowedSection = raw.match(/### Allowed[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/);
  if (allowedSection) {
    const patternMatches = allowedSection[1].matchAll(/- `([^`]+)`/g);
    for (const m of patternMatches) {
      allowPatterns.push(m[1]);
    }
  }

  return {
    name: "cursor",
    path: RULE_PATH,
    shell,
    allowPatterns,
    denyPatterns,
    filesystem
  };
}

export const cursorAdapter: Adapter = {
  name: "cursor",
  paths: PATHS,

  render(permissions: Permissions, options?: AdapterOptions): GeneratedFile[] {
    const files: GeneratedFile[] = [{ path: RULE_PATH, content: renderRule(permissions) }];
    if (options?.mcp) {
      files.push({ path: MCP_PATH, content: renderMcp(options.mcp) });
    }
    return files;
  },

  parse(raw: string, _path: string): DetectedRuntime {
    return parse(raw);
  },

  owns(path: string): boolean {
    return path === RULE_PATH || path === MCP_PATH;
  }
};

/** @deprecated Use cursorAdapter.render() instead */
export function renderCursorRule(permissions: Permissions): string {
  return renderRule(permissions);
}

/** @deprecated Use cursorAdapter.render() instead */
export function renderCursorMcp(mcp: McpConfig): string {
  return renderMcp(mcp);
}
