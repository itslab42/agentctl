"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const claude_1 = require("../src/adapters/claude");
const permissions = { policy: { precedence: "deny_over_allow" }, filesystem: { edit: "allow", write: "allow" }, shell: { default: "ask", allow: ["git*", "pnpm*"], deny: ["git push*"] } };
(0, node_test_1.default)("Claude maps filesystem and shell permissions deterministically", () => {
    const output = (0, claude_1.renderClaude)(permissions);
    const parsed = JSON.parse(output);
    strict_1.default.deepEqual(parsed.permissions.allow, ["Edit", "Write", "Bash(git*)", "Bash(pnpm*)"]);
    strict_1.default.deepEqual(parsed.permissions.deny, ["Bash(git push*)"]);
    strict_1.default.equal(output, (0, claude_1.renderClaude)(permissions));
});
