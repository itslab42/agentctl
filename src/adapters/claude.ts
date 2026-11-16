import {
  Permissions,
  PermissionValue,
  CapabilityPermissions,
  GENERATED_MARKER
} from "../permissions";
import { ClaudeSettings, claudeDefaults } from "../config";
import { McpConfig } from "../mcp";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";

const PATHS = [".claude/settings.json"];

/**
 * Maps a v2 filesystem capability block onto Claude `Read`/`Edit`/`Write`
 * permission entries, distributing each pattern into the allow/ask/deny arrays.
 * `tools` is the set of Claude tools the mode governs (read → Read; write →
 * Edit + Write).
 */
function fsCapabilityToRules(
  cap: CapabilityPermissions,
  tools: string[],
  buckets: { allow: string[]; ask: string[]; deny: string[] }
): void {
  const emit = (patterns: string[], bucket: string[]): void => {
    for (const pattern of patterns) {
      for (const tool of tools) bucket.push(`${tool}(${pattern})`);
    }
  };
  emit(cap.deny, buckets.deny);
  emit(cap.ask, buckets.ask);
  emit(cap.allow, buckets.allow);
}

/**
 * Maps a v2 network capability onto Claude `WebFetch`/`WebSearch` permission
 * entries. Only `WebFetch(domain:...)` is scopable in Claude, so URL patterns
 * are reduced to their host; `WebSearch` is added for the default outcome.
 */
function networkToRules(
  cap: CapabilityPermissions,
  buckets: { allow: string[]; ask: string[]; deny: string[] }
): void {
  const host = (pattern: string): string => {
    const match = pattern.match(/^(?:https?|\*):\/\/([^/]+)/);
    return match ? match[1] : pattern;
  };
  const emit = (patterns: string[], bucket: string[]): void => {
    for (const pattern of patterns) bucket.push(`WebFetch(domain:${host(pattern)})`);
  };
  emit(cap.deny, buckets.deny);
  emit(cap.ask, buckets.ask);
  emit(cap.allow, buckets.allow);
}

/** Formats a v2 capability block as advisory comment lines (name: value). */
function advisoryLines(name: string, cap: CapabilityPermissions): string[] {
  const fmt = (list: string[]): string => (list.length ? list.join(", ") : "(none)");
  return [
    `${name} access is advisory in Claude (not natively enforceable):`,
    `  default: ${cap.default}`,
    `  allow: ${fmt(cap.allow)}`,
    `  ask: ${fmt(cap.ask)}`,
    `  deny: ${fmt(cap.deny)}`
  ];
}

function render(
  permissions: Permissions,
  settings: ClaudeSettings = claudeDefaults,
  mcp?: McpConfig
): string {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  // Filesystem: prefer v2 path-level rules; fall back to v1 blanket scalars.
  if (permissions.filesystem.read) {
    fsCapabilityToRules(permissions.filesystem.read, ["Read"], { allow, ask, deny });
  }
  if (permissions.filesystem.writePaths) {
    fsCapabilityToRules(permissions.filesystem.writePaths, ["Edit", "Write"], { allow, ask, deny });
  } else {
    if (permissions.filesystem.edit === "allow") allow.push("Edit");
    if (permissions.filesystem.write === "allow") allow.push("Write");
  }

  allow.push(...permissions.shell.allow.map((pattern) => `Bash(${pattern})`));
  deny.push(...permissions.shell.deny.map((pattern) => `Bash(${pattern})`));

  // v2: network → Claude WebFetch/WebSearch entries.
  if (permissions.network) {
    networkToRules(permissions.network, { allow, ask, deny });
  }

  const env: Record<string, string> = {};
  if (settings.disableTelemetry) {
    env.DISABLE_TELEMETRY = "1";
    env.DISABLE_ERROR_REPORTING = "1";
    env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = "1";
  }
  const permissionsBlock: Record<string, unknown> = { allow, deny };
  if (ask.length > 0) permissionsBlock.ask = ask;
  const value: Record<string, unknown> = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    _generatedBy: GENERATED_MARKER,
    cleanupPeriodDays: settings.cleanupPeriodDays,
    alwaysThinkingEnabled: settings.alwaysThinkingEnabled,
    permissions: permissionsBlock
  };

  // v2: env and MCP tool permissions have no native Claude equivalent — surface
  // them as advisory notes so the policy is not silently dropped.
  const advisory: string[] = [];
  if (permissions.env) advisory.push(...advisoryLines("env", permissions.env));
  if (permissions.mcp) advisory.push(...advisoryLines("mcp", permissions.mcp));
  if (advisory.length > 0) value._advisory = advisory;

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
