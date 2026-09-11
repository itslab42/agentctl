import {
  Permissions,
  PermissionValue,
  CapabilityPermissions,
  GENERATED_MARKER
} from "../permissions";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";
import { McpConfig } from "../mcp";

const PATHS = [".opencode/opencode.json"];

/**
 * Renders a v2 capability block into OpenCode's granular object syntax
 * (`{ "*": default, "<pattern>": action }`). OpenCode evaluates rules with the
 * last matching rule winning, so emit the catch-all default first, then allow,
 * then ask, then deny — preserving `deny_over_allow` precedence.
 */
function capabilityToObject(cap: CapabilityPermissions): Record<string, string> {
  const map: Record<string, string> = { "*": cap.default };
  for (const pattern of cap.allow) map[pattern] = "allow";
  for (const pattern of cap.ask) map[pattern] = "ask";
  for (const pattern of cap.deny) map[pattern] = "deny";
  return map;
}

/** Formats a v2 capability block as advisory comment lines. */
function advisoryLines(name: string, cap: CapabilityPermissions): string[] {
  const fmt = (list: string[]): string => (list.length ? list.join(", ") : "(none)");
  return [
    `${name} access is advisory in OpenCode (not natively enforceable):`,
    `  default: ${cap.default}`,
    `  allow: ${fmt(cap.allow)}`,
    `  ask: ${fmt(cap.ask)}`,
    `  deny: ${fmt(cap.deny)}`
  ];
}

function render(permissions: Permissions, mcp?: McpConfig): string {
  const bash: Record<string, string> = { "*": permissions.shell.default };
  for (const pattern of permissions.shell.allow) bash[pattern] = "allow";
  for (const pattern of permissions.shell.deny) bash[pattern] = "deny";

  const permission: Record<string, unknown> = {};

  // Filesystem: v2 path-level rules map to OpenCode's native `read`/`edit`
  // object syntax; fall back to the v1 blanket scalars otherwise.
  if (permissions.filesystem.read) {
    permission.read = capabilityToObject(permissions.filesystem.read);
  }
  if (permissions.filesystem.writePaths) {
    permission.edit = capabilityToObject(permissions.filesystem.writePaths);
  } else {
    permission.edit = permissions.filesystem.edit;
    permission.write = permissions.filesystem.write;
  }

  permission.bash = bash;

  // v2: network → OpenCode's native `webfetch`/`websearch` object syntax.
  if (permissions.network) {
    permission.webfetch = capabilityToObject(permissions.network);
    permission.websearch = { "*": permissions.network.default };
  }

  const value: Record<string, unknown> = {
    _generatedBy: GENERATED_MARKER,
    permission
  };

  // v2: env and MCP tool permissions have no native OpenCode key — surface them
  // as advisory notes so the policy is not silently dropped.
  const advisory: string[] = [];
  if (permissions.env) advisory.push(...advisoryLines("env", permissions.env));
  if (permissions.mcp) advisory.push(...advisoryLines("mcp", permissions.mcp));
  if (advisory.length > 0) value._advisory = advisory;

  if (mcp) {
    const servers: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(mcp.servers)) {
      const entry: Record<string, unknown> =
        server.transport === "stdio"
          ? { type: "local", command: [server.command, ...(server.args ?? [])] }
          : { type: "remote", url: server.url };
      if (server.transport === "stdio") {
        if (server.env && Object.keys(server.env).length > 0) entry.environment = server.env;
      }
      servers[name] = entry;
    }
    value.mcp = servers;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parse(raw: string): DetectedRuntime {
  const parsed = JSON.parse(raw) as {
    permission?: {
      edit?: string;
      write?: string;
      bash?: Record<string, string>;
    };
  };
  const perm = parsed.permission ?? {};
  const bash = perm.bash ?? {};

  let shell: PermissionValue = "ask";
  if (bash["*"]) {
    const val = bash["*"];
    if (val === "allow" || val === "ask" || val === "deny") {
      shell = val;
    }
  }

  const allowPatterns: string[] = [];
  const denyPatterns: string[] = [];

  for (const [pattern, value] of Object.entries(bash)) {
    if (pattern === "*") continue;
    if (value === "allow") allowPatterns.push(pattern);
    else if (value === "deny") denyPatterns.push(pattern);
  }

  const filesystem: { edit?: PermissionValue; write?: PermissionValue } = {};
  if (perm.edit && (perm.edit === "allow" || perm.edit === "ask" || perm.edit === "deny")) {
    filesystem.edit = perm.edit as PermissionValue;
  }
  if (perm.write && (perm.write === "allow" || perm.write === "ask" || perm.write === "deny")) {
    filesystem.write = perm.write as PermissionValue;
  }

  return {
    name: "opencode",
    path: PATHS[0],
    shell,
    allowPatterns,
    denyPatterns,
    filesystem
  };
}

export const opencodeAdapter: Adapter = {
  name: "opencode",
  paths: PATHS,

  render(permissions: Permissions, options?: AdapterOptions): GeneratedFile[] {
    return [{ path: PATHS[0], content: render(permissions, options?.mcp) }];
  },

  parse(raw: string, _path: string): DetectedRuntime {
    return parse(raw);
  },

  owns(path: string): boolean {
    return PATHS.includes(path);
  }
};

/** @deprecated Use opencodeAdapter.render() instead */
export function renderOpenCode(permissions: Permissions, mcp?: McpConfig): string {
  return render(permissions, mcp);
}
