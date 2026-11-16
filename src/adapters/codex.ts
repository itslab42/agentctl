import { Permissions, PermissionValue, globToRegexSource, GENERATED_MARKER } from "../permissions";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";
import { CodexSettings, codexDefaults } from "../config";
import { regexSourceToGlob } from "../scan";

const PATHS = [".codex/config.toml", ".codex/hooks/permission-policy.py"];

function renderConfig(permissions: Permissions): string {
  const writable =
    permissions.filesystem.edit === "allow" && permissions.filesystem.write === "allow";
  const approval =
    permissions.shell.default === "ask"
      ? "on-request"
      : permissions.shell.default === "deny"
        ? "never"
        : "auto";

  // v2: when path-level filesystem or network policies are present, register
  // the same hook for the corresponding tools so the policy is enforced there
  // too (not just for Bash).
  const hookTools = ["Bash"];
  if (permissions.filesystem.read) hookTools.push("Read");
  if (permissions.filesystem.writePaths) hookTools.push("Edit", "Write");
  if (permissions.network) hookTools.push("WebFetch");
  const hookLines = hookTools
    .map((tool) => `${tool} = ".codex/hooks/permission-policy.py"`)
    .join("\n");

  return `# ${GENERATED_MARKER}\napproval_policy = "${approval}"\nsandbox_mode = "${writable ? "workspace-write" : "read-only"}"\n\n[hooks.PreToolUse]\n${hookLines}\n`;
}

/** Maps a v2 capability block into allow/deny regex-source pattern arrays. */
function capabilityToRegex(cap: {
  allow: string[];
  deny: string[];
  ask: string[];
  default: PermissionValue;
}): { allow: string[]; deny: string[]; ask: string[]; default: PermissionValue } {
  return {
    allow: cap.allow.map(globToRegexSource),
    deny: cap.deny.map(globToRegexSource),
    ask: cap.ask.map(globToRegexSource),
    default: cap.default
  };
}

function renderHook(permissions: Permissions, settings: CodexSettings = codexDefaults): string {
  const denyPatterns = permissions.shell.deny.map(globToRegexSource);
  const allowPatterns = permissions.shell.allow.map(globToRegexSource);
  const notifyOnDeny = settings.notifyOnDeny;

  // v2 capability policies keyed by the tool name they govern. Each entry
  // enforces deny → ask → allow → default against the tool's path/URL input.
  const fsRead = permissions.filesystem.read
    ? capabilityToRegex(permissions.filesystem.read)
    : null;
  const fsWrite = permissions.filesystem.writePaths
    ? capabilityToRegex(permissions.filesystem.writePaths)
    : null;
  const network = permissions.network ? capabilityToRegex(permissions.network) : null;

  const capabilityPolicies: Record<string, unknown> = {};
  if (fsRead) capabilityPolicies.Read = { field: "path", ...fsRead };
  if (fsWrite) {
    capabilityPolicies.Edit = { field: "path", ...fsWrite };
    capabilityPolicies.Write = { field: "path", ...fsWrite };
  }
  if (network) capabilityPolicies.WebFetch = { field: "url", ...network };

  // v2: env and MCP tool permissions have no Codex hook equivalent — surface
  // them as advisory comments so the policy is not silently dropped.
  const advisory: string[] = [];
  const fmt = (list: string[]): string => (list.length ? list.join(", ") : "(none)");
  for (const [name, cap] of [
    ["env", permissions.env],
    ["mcp", permissions.mcp]
  ] as const) {
    if (!cap) continue;
    advisory.push(
      `# ${name} access is advisory in Codex (not natively enforceable):`,
      `#   default: ${cap.default}`,
      `#   allow: ${fmt(cap.allow)}`,
      `#   ask: ${fmt(cap.ask)}`,
      `#   deny: ${fmt(cap.deny)}`
    );
  }
  const advisoryComment = advisory.length ? `${advisory.join("\n")}\n` : "";

  return `#!/usr/bin/env python3
# ${GENERATED_MARKER}
# Source: .ai/permissions.yaml
${advisoryComment}import json
import re
import sys

DENY_PATTERNS = ${JSON.stringify(denyPatterns, null, 2)}

ALLOW_PATTERNS = ${JSON.stringify(allowPatterns, null, 2)}

# v2 capability policies keyed by tool name. Each governs a tool_input field
# (path or url) with deny -> ask -> allow -> default precedence.
CAPABILITY_POLICIES = ${JSON.stringify(capabilityPolicies, null, 2)}

NOTIFY_ON_DENY = ${notifyOnDeny ? "True" : "False"}


def deny(reason: str) -> None:
    """Emit a deny decision and optionally log to stderr."""
    if NOTIFY_ON_DENY:
        print(f"[agentctl] denied: {reason}", file=sys.stderr)
    print(json.dumps({"permissionDecision": "deny", "permissionDecisionReason": reason}))


def allow(reason: str) -> None:
    """Emit an allow decision."""
    print(json.dumps({"permissionDecision": "allow", "permissionDecisionReason": reason}))


def ask(reason: str) -> None:
    """Emit an ask decision."""
    print(json.dumps({"permissionDecision": "ask", "permissionDecisionReason": reason}))


def enforce_capability(policy: dict, value: str) -> None:
    """Apply deny -> ask -> allow -> default precedence to a capability value."""
    if any(re.match(p, value) for p in policy["deny"]):
        deny("Blocked by agentctl policy")
        return
    if any(re.match(p, value) for p in policy["ask"]):
        ask("Approval required by agentctl policy")
        return
    if any(re.match(p, value) for p in policy["allow"]):
        allow("Approved by agentctl policy")
        return
    default = policy["default"]
    if default == "deny":
        deny("Blocked by agentctl default policy")
    elif default == "ask":
        ask("Approval required by agentctl default policy")


def main() -> None:
    try:
        invocation = json.load(sys.stdin)
    except json.JSONDecodeError:
        return
    tool_name = invocation.get("tool_name")
    tool_input = invocation.get("tool_input", {})

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if any(re.match(pattern, command) for pattern in DENY_PATTERNS):
            deny("Blocked by agentctl shell deny policy")
            return
        if any(re.match(pattern, command) for pattern in ALLOW_PATTERNS):
            allow("Approved by agentctl shell allow policy")
        return

    policy = CAPABILITY_POLICIES.get(tool_name)
    if policy is not None:
        value = tool_input.get(policy["field"], "")
        enforce_capability(policy, value)

if __name__ == "__main__":
    main()
`;
}

/**
 * Parse codex config. Supports both `.codex/config.toml` and top-level `codex.json`.
 */
function parseConfig(raw: string, path: string): DetectedRuntime {
  let shell: PermissionValue = "ask";
  const allowPatterns: string[] = [];
  const denyPatterns: string[] = [];

  if (path.endsWith(".toml")) {
    const approvalMatch = raw.match(/approval_policy\s*=\s*"([^"]+)"/);
    if (approvalMatch) {
      const policy = approvalMatch[1];
      if (policy === "auto") shell = "allow";
      else if (policy === "never") shell = "deny";
      else shell = "ask";
    }
  } else {
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
export function parseCodexHook(raw: string): { allow: string[]; deny: string[] } {
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

export const codexAdapter: Adapter = {
  name: "codex",
  paths: PATHS,

  render(permissions: Permissions, options?: AdapterOptions): GeneratedFile[] {
    return [
      { path: PATHS[0], content: renderConfig(permissions) },
      {
        path: PATHS[1],
        content: renderHook(permissions, options?.codex ?? codexDefaults),
        executable: true
      }
    ];
  },

  parse(raw: string, path: string): DetectedRuntime {
    return parseConfig(raw, path);
  },

  owns(path: string): boolean {
    return path === PATHS[0] || path === PATHS[1] || path === "codex.json";
  }
};

/** @deprecated Use codexAdapter.render() instead */
export function renderCodexConfig(permissions: Permissions): string {
  return renderConfig(permissions);
}

/** @deprecated Use codexAdapter.render() instead */
export function renderCodexHook(
  permissions: Permissions,
  settings: CodexSettings = codexDefaults
): string {
  return renderHook(permissions, settings);
}
