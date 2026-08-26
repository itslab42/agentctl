import { Permissions, PermissionValue, GENERATED_MARKER } from "../permissions";
import { ClaudeSettings, claudeDefaults } from "../config";
import { McpConfig } from "../mcp";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";

const PATHS = [".claude/settings.json"];

function render(
  permissions: Permissions,
  settings: ClaudeSettings = claudeDefaults,
  mcp?: McpConfig
): string {
  const allow: string[] = [];
  if (permissions.filesystem.edit === "allow") allow.push("Edit");
  if (permissions.filesystem.write === "allow") allow.push("Write");
  allow.push(...permissions.shell.allow.map((pattern) => `Bash(${pattern})`));
  const env: Record<string, string> = {};
  if (settings.disableTelemetry) {
    env.DISABLE_TELEMETRY = "1";
    env.DISABLE_ERROR_REPORTING = "1";
    env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = "1";
  }
  const value: Record<string, unknown> = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    _generatedBy: GENERATED_MARKER,
    cleanupPeriodDays: settings.cleanupPeriodDays,
    alwaysThinkingEnabled: settings.alwaysThinkingEnabled,
    permissions: { allow, deny: permissions.shell.deny.map((pattern) => `Bash(${pattern})`) }
  };
  if (Object.keys(env).length > 0) value.env = env;
  if (mcp) {
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
    value.mcpServers = mcpServers;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parse(raw: string): DetectedRuntime {
  const parsed = JSON.parse(raw) as {
    permissions?: { allow?: string[]; deny?: string[] };
  };
  const perms = parsed.permissions ?? {};
  const allowList = perms.allow ?? [];
  const denyList = perms.deny ?? [];

  const allow = allowList
    .filter((p: string) => p.startsWith("Bash(") && p.endsWith(")"))
    .map((p: string) => p.slice(5, -1));
  const deny = denyList
    .filter((p: string) => p.startsWith("Bash(") && p.endsWith(")"))
    .map((p: string) => p.slice(5, -1));

  const filesystem: { edit?: PermissionValue; write?: PermissionValue } = {};
  if (allowList.includes("Edit")) {
    filesystem.edit = "allow";
  } else if (denyList.includes("Edit")) {
    filesystem.edit = "deny";
  } else {
    filesystem.edit = "ask";
  }
  if (allowList.includes("Write")) {
    filesystem.write = "allow";
  } else if (denyList.includes("Write")) {
    filesystem.write = "deny";
  } else {
    filesystem.write = "ask";
  }

  const shell: PermissionValue = "ask";

  return {
    name: "claude",
    path: PATHS[0],
    shell,
    allowPatterns: allow,
    denyPatterns: deny,
    filesystem
  };
}

export const claudeAdapter: Adapter = {
  name: "claude",
  paths: PATHS,

  render(permissions: Permissions, options?: AdapterOptions): GeneratedFile[] {
    return [
      {
        path: PATHS[0],
        content: render(permissions, options?.claude ?? claudeDefaults, options?.mcp)
      }
    ];
  },

  parse(raw: string, _path: string): DetectedRuntime {
    return parse(raw);
  },

  owns(path: string): boolean {
    return PATHS.includes(path);
  }
};

/** @deprecated Use claudeAdapter.render() instead */
export function renderClaude(
  permissions: Permissions,
  settings: ClaudeSettings = claudeDefaults,
  mcp?: McpConfig
): string {
  return render(permissions, settings, mcp);
}
