import { stringify } from "yaml";
import { PermissionValue } from "./permissions";

export interface Preset {
  name: string;
  description: string;
  permissions: {
    policy: { precedence: "deny_over_allow" };
    filesystem: { edit: PermissionValue; write: PermissionValue };
    shell: { default: PermissionValue; allow: string[]; deny: string[] };
  };
}

export const presets: Record<string, Preset> = {
  readonly: {
    name: "readonly",
    description: "Safest — read-only access, no writes or destructive commands",
    permissions: {
      policy: { precedence: "deny_over_allow" },
      filesystem: { edit: "deny", write: "deny" },
      shell: {
        default: "deny",
        allow: [
          "cat *",
          "ls *",
          "find *",
          "grep *",
          "wc *",
          "head *",
          "tail *",
          "file *",
          "which *",
          "git status",
          "git log *",
          "git diff *"
        ],
        deny: []
      }
    }
  },
  standard: {
    name: "standard",
    description: "Balanced — build, test, and commit but no destructive operations",
    permissions: {
      policy: { precedence: "deny_over_allow" },
      filesystem: { edit: "allow", write: "allow" },
      shell: {
        default: "ask",
        allow: [
          "cat *",
          "ls *",
          "find *",
          "grep *",
          "wc *",
          "head *",
          "tail *",
          "which *",
          "npm *",
          "pnpm *",
          "yarn *",
          "cargo *",
          "go *",
          "make *",
          "python *",
          "git status",
          "git log *",
          "git diff *",
          "git branch",
          "git add *",
          "git commit *"
        ],
        deny: [
          "rm -rf *",
          "rm -r *",
          "git push --force*",
          "git reset --hard *",
          "git clean *",
          "git rebase *",
          "sudo *",
          "chmod -R *",
          "chown *"
        ]
      }
    }
  },
  trusted: {
    name: "trusted",
    description: "Maximum autonomy — minimal restrictions for sandboxed environments",
    permissions: {
      policy: { precedence: "deny_over_allow" },
      filesystem: { edit: "allow", write: "allow" },
      shell: {
        default: "allow",
        allow: [],
        deny: ["rm -rf /", "rm -rf ~*", "sudo rm *", "mkfs *", "dd if=*"]
      }
    }
  }
};

/** Serialize a preset's permissions to YAML. */
export function renderPreset(preset: Preset): string {
  return stringify(preset.permissions, { lineWidth: 120 });
}

/** List all available preset names. */
export function listPresetNames(): string[] {
  return Object.keys(presets);
}
