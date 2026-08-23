"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePermissions = parsePermissions;
exports.globToRegexSource = globToRegexSource;
const values = new Set(["allow", "ask", "deny"]);
function asObject(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}
function permission(value, label) {
    if (typeof value !== "string" || !values.has(value)) {
        throw new Error(`${label} must be one of: allow, ask, deny`);
    }
    return value;
}
function patterns(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
        throw new Error(`${label} must be an array of non-empty strings`);
    }
    const result = value;
    if (new Set(result).size !== result.length)
        throw new Error(`${label} contains duplicate patterns`);
    return result;
}
/** Validates the runtime-neutral source-of-truth permission format. */
function parsePermissions(raw) {
    const root = asObject(raw, "permissions");
    const policy = asObject(root.policy, "policy");
    if (policy.precedence !== "deny_over_allow") {
        throw new Error("policy.precedence must be deny_over_allow");
    }
    const filesystem = asObject(root.filesystem, "filesystem");
    const shell = asObject(root.shell, "shell");
    const parsed = {
        policy: { precedence: "deny_over_allow" },
        filesystem: {
            edit: permission(filesystem.edit, "filesystem.edit"),
            write: permission(filesystem.write, "filesystem.write")
        },
        shell: {
            default: permission(shell.default, "shell.default"),
            allow: patterns(shell.allow ?? [], "shell.allow"),
            deny: patterns(shell.deny ?? [], "shell.deny")
        }
    };
    const overlap = parsed.shell.allow.filter((pattern) => parsed.shell.deny.includes(pattern));
    if (overlap.length)
        throw new Error(`contradictory shell allow/deny patterns: ${overlap.join(", ")}`);
    return parsed;
}
function globToRegexSource(glob) {
    return "^" + glob.replace(/[.+^${}()|[\\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
}
