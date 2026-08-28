import { Permissions, PermissionValue, globToRegexSource, GENERATED_MARKER } from "../permissions";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";
import { CodexSettings, codexDefaults } from "../config";
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

function renderHook(permissions: Permissions, settings: CodexSettings = codexDefaults): string {
  const denyPatterns = permissions.shell.deny.map(globToRegexSource);
  const allowPatterns = permissions.shell.allow.map(globToRegexSource);
  const fsWriteDenied = permissions.filesystem.write === "deny";
  const fsEditDenied = permissions.filesystem.edit === "deny";
  const notifyOnDeny = settings.notifyOnDeny;

  return `#!/usr/bin/env python3
# ${GENERATED_MARKER}
# Source: .ai/permissions.yaml
import json
import re
import sys

DENY_PATTERNS = ${JSON.stringify(denyPatterns, null, 2)}

ALLOW_PATTERNS = ${JSON.stringify(allowPatterns, null, 2)}

# Filesystem permission enforcement
FS_WRITE_DENIED = ${fsWriteDenied ? "True" : "False"}
FS_EDIT_DENIED = ${fsEditDenied ? "True" : "False"}
NOTIFY_ON_DENY = ${notifyOnDeny ? "True" : "False"}

# Patterns that indicate file-write operations in shell commands
WRITE_COMMAND_PATTERNS = [
    r"\\b(tee|dd|install)\\b",
    r">",
    r"\\bcp\\b",
    r"\\bmv\\b",
    r"\\brm\\b",
    r"\\bmkdir\\b",
    r"\\bchmod\\b",
    r"\\bchown\\b",
    r"\\bln\\b",
    r"\\btouch\\b",
]

EDIT_COMMAND_PATTERNS = [
    r"\\bsed\\b.*-i",
    r"\\bperl\\b.*-[ip]",
    r"\\bpatch\\b",
]


def is_write_command(command: str) -> bool:
    """Check if a shell command would write to the filesystem."""
    return any(re.search(pattern, command) for pattern in WRITE_COMMAND_PATTERNS)


def is_edit_command(command: str) -> bool:
    """Check if a shell command would edit existing files in-place."""
    return any(re.search(pattern, command) for pattern in EDIT_COMMAND_PATTERNS)


def deny(reason: str) -> None:
    """Emit a deny decision and optionally log to stderr."""
    if NOTIFY_ON_DENY:
        print(f"[agentctl] denied: {reason}", file=sys.stderr)
    print(json.dumps({"permissionDecision": "deny", "permissionDecisionReason": reason}))


def main() -> None:
    try:
        invocation = json.load(sys.stdin)
    except json.JSONDecodeError:
        return
    if invocation.get("tool_name") != "Bash":
        return
    command = invocation.get("tool_input", {}).get("command", "")
    if any(re.match(pattern, command) for pattern in DENY_PATTERNS):
        deny("Blocked by agentctl shell deny policy")
        return
    # Filesystem permission enforcement: deny write/edit commands when policy forbids them
    if FS_WRITE_DENIED and is_write_command(command):
        deny("Blocked by agentctl filesystem write deny policy")
        return
    if FS_EDIT_DENIED and is_edit_command(command):
        deny("Blocked by agentctl filesystem edit deny policy")
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
