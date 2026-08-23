import test from "node:test";
import assert from "node:assert/strict";
import { renderOpenCode } from "../src/adapters/opencode";
import { Permissions } from "../src/permissions";

test("OpenCode renders native allow and deny rules with deny entries after broad allows", () => {
  const p: Permissions = { policy: { precedence: "deny_over_allow" }, filesystem: { edit: "allow", write: "allow" }, shell: { default: "ask", allow: ["git*"], deny: ["git push*", "git reset --hard*"] } };
  const permission = JSON.parse(renderOpenCode(p)).permission;
  assert.equal(permission.edit, "allow");
  assert.equal(permission.bash["git*"], "allow");
  assert.equal(permission.bash["git push*"], "deny");
  assert.deepEqual(Object.keys(permission.bash), ["*", "git*", "git push*", "git reset --hard*"]);
});
