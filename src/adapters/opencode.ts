import { Permissions, PermissionValue, GENERATED_MARKER } from "../permissions";
import { Adapter, AdapterOptions, DetectedRuntime, GeneratedFile } from "../adapter";

const PATHS = [".opencode/opencode.json"];

function render(permissions: Permissions): string {
  const bash: Record<string, string> = { "*": permissions.shell.default };
  for (const pattern of permissions.shell.allow) bash[pattern] = "allow";
  for (const pattern of permissions.shell.deny) bash[pattern] = "deny";
  return `${JSON.stringify({ _generatedBy: GENERATED_MARKER, permission: { edit: permissions.filesystem.edit, write: permissions.filesystem.write, bash } }, null, 2)}\n`;
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

  render(permissions: Permissions, _options?: AdapterOptions): GeneratedFile[] {
    return [{ path: PATHS[0], content: render(permissions) }];
  },

  parse(raw: string, _path: string): DetectedRuntime {
    return parse(raw);
  },

  owns(path: string): boolean {
    return PATHS.includes(path);
  }
};

/** @deprecated Use opencodeAdapter.render() instead */
export function renderOpenCode(permissions: Permissions): string {
  return render(permissions);
}
