"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const opencode_1 = require("../src/adapters/opencode");
(0, node_test_1.default)("OpenCode renders native allow and deny rules with deny entries after broad allows", () => {
    const p = { policy: { precedence: "deny_over_allow" }, filesystem: { edit: "allow", write: "allow" }, shell: { default: "ask", allow: ["git*"], deny: ["git push*", "git reset --hard*"] } };
    const permission = JSON.parse((0, opencode_1.renderOpenCode)(p)).permission;
    strict_1.default.equal(permission.edit, "allow");
    strict_1.default.equal(permission.bash["git*"], "allow");
    strict_1.default.equal(permission.bash["git push*"], "deny");
    strict_1.default.deepEqual(Object.keys(permission.bash), ["*", "git*", "git push*", "git reset --hard*"]);
});
