import test from "node:test";
import assert from "node:assert/strict";
import { renderClaude } from "../src/adapters/claude";
import { Permissions } from "../src/permissions";

const permissions: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: { default: "ask", allow: ["git*", "pnpm*"], deny: ["git push*"] }
};
test("Claude maps filesystem and shell permissions deterministically", () => {
  const output = renderClaude(permissions);
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.permissions.allow, ["Edit", "Write", "Bash(git*)", "Bash(pnpm*)"]);
  assert.deepEqual(parsed.permissions.deny, ["Bash(git push*)"]);
  assert.equal(output, renderClaude(permissions));
});
