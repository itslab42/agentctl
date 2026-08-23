"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderOpenCode = renderOpenCode;
/** OpenCode uses glob-keyed native permission rules; deny entries are emitted after allows. */
function renderOpenCode(permissions) {
    const bash = { "*": permissions.shell.default };
    for (const pattern of permissions.shell.allow)
        bash[pattern] = "allow";
    // Specific hard-deny entries intentionally override broad allow rules.
    for (const pattern of permissions.shell.deny)
        bash[pattern] = "deny";
    return `${JSON.stringify({ permission: { edit: permissions.filesystem.edit, write: permissions.filesystem.write, bash } }, null, 2)}\n`;
}
