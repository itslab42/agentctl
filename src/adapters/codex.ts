import { Permissions, PermissionValue, globToRegexSource, GENERATED_MARKER } from "../permissions";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";
import { regexSourceToGlob } from "../scan";

const PATHS = [".codex/config.toml", ".codex/hooks/permission-policy.py"];

function renderConfig(permissions: Permissions): string {
  const writable =
    permissions.filesystem.edit === "allow" || permissions.filesystem.write === "allow";
  const approval =
    permissions.shell.default === "ask"
      ? "on-request"
      : permissions.shell.default === "deny"
        ? "never"
        : "auto";
  return `# ${GENERATED_MARKER}\napproval_policy = "${approval}"\nsandbox_mode = "${writable ? "workspace-write" : "read-only"}"\n\n[hooks.PreToolUse]\nBash = ".codex/hooks/permission-policy.py"\n`;
}

function renderHook(permissions: Permissions): string {
  const denyPatterns = permissions.shell.deny.map(globToRegexSource);
  const allowPatterns = permissions.shell.allow.map(globToRegexSource);
  return `#!/usr/bin/env python3
# ${GENERATED_MARKER}
# Source: .ai/permissions.yaml
import json
import re
import sys

DENY_PATTERNS = ${JSON.stringify(denyPatterns, null, 2)}

ALLOW_PATTERNS = ${JSON.stringify(allowPatterns, null, 2)}

def main() -> None:
    try:
        invocation = json.load(sys.stdin)
    except json.JSONDecodeError:
        return
    if invocation.get("tool_name") != "Bash":
        return
    command = invocation.get("tool_input", {}).get("command", "")
    if any(re.match(pattern, command) for pattern in DENY_PATTERNS):
        print(json.dumps({"permissionDecision": "deny", "permissionDecisionReason": "Blocked by agentctl shell deny policy"}))
        return
    if any(re.match(pattern, command) for pattern in ALLOW_PATTERNS):
        print(json.dumps({"permissionDecision": "allow", "permissionDecisionReason": "Approved by agentctl shell allow policy"}))

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

  render(permissions: Permissions, _options?: AdapterOptions): GeneratedFile[] {
    return [
      { path: PATHS[0], content: renderConfig(permissions) },
      { path: PATHS[1], content: renderHook(permissions), executable: true }
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
export function renderCodexHook(permissions: Permissions): string {
  return renderHook(permissions);
}
