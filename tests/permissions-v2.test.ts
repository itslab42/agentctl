import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { parsePermissions } from "../src/permissions";
import { renderKiro } from "../src/adapters/kiro";

const V1_YAML = `
policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: ["pnpm *"]
  deny: ["rm -rf *"]
`;

const V2_YAML = `
version: 2
policy:
  precedence: deny_over_allow
filesystem:
  read:
    default: allow
    deny:
      - ".env*"
      - "**/*.pem"
  write:
    default: allow
    ask:
      - "*.config.*"
    deny:
      - ".git/**"
shell:
  default: ask
  allow: ["pnpm *"]
  deny: ["rm -rf *"]
network:
  default: ask
  allow:
    - "https://registry.npmjs.org/*"
    - "*://api.github.com/*"
  deny:
    - "http://*"
env:
  default: deny
  allow: ["NODE_ENV", "GITHUB_*"]
  deny: ["*_TOKEN"]
mcp:
  default: ask
  allow: ["filesystem:*", "postgres:query"]
  deny: ["postgres:drop_table"]
`;

// --- Backwards compatibility -------------------------------------------------

test("v1 files (no version field) parse to version 1", () => {
  const p = parsePermissions(parse(V1_YAML));
  assert.equal(p.version, 1);
  assert.equal(p.filesystem.edit, "allow");
  assert.equal(p.filesystem.write, "allow");
  assert.equal(p.filesystem.read, undefined);
  assert.equal(p.filesystem.writePaths, undefined);
  assert.equal(p.network, undefined);
  assert.equal(p.env, undefined);
  assert.equal(p.mcp, undefined);
});

test("explicit version: 1 is accepted", () => {
  const p = parsePermissions({
    version: 1,
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask" }
  });
  assert.equal(p.version, 1);
});

test("version must be 1 or 2", () => {
  assert.throws(
    () =>
      parsePermissions({
        version: 3,
        policy: { precedence: "deny_over_allow" },
        filesystem: { edit: "allow", write: "allow" },
        shell: { default: "ask" }
      }),
    /version must be 1 or 2/
  );
});

// --- v2 filesystem path rules ------------------------------------------------

test("v2 filesystem read/write blocks parse into capability objects", () => {
  const p = parsePermissions(parse(V2_YAML));
  assert.equal(p.version, 2);
  assert.ok(p.filesystem.read);
  assert.equal(p.filesystem.read.default, "allow");
  assert.deepEqual(p.filesystem.read.deny, [".env*", "**/*.pem"]);
  assert.ok(p.filesystem.writePaths);
  assert.deepEqual(p.filesystem.writePaths.ask, ["*.config.*"]);
  assert.deepEqual(p.filesystem.writePaths.deny, [".git/**"]);
});

test("v2 derives v1 scalars from read/write defaults", () => {
  const p = parsePermissions(parse(V2_YAML));
  // read.default → edit scalar; write.default → write scalar
  assert.equal(p.filesystem.edit, "allow");
  assert.equal(p.filesystem.write, "allow");
});

test("v2 filesystem may still use v1 scalar write alongside read block", () => {
  const p = parsePermissions({
    version: 2,
    policy: { precedence: "deny_over_allow" },
    filesystem: { read: { default: "ask" }, write: "deny" },
    shell: { default: "ask" }
  });
  assert.equal(p.filesystem.write, "deny");
  assert.equal(p.filesystem.edit, "ask");
  assert.equal(p.filesystem.writePaths, undefined);
});

// --- Network -----------------------------------------------------------------

test("v2 network patterns parse and validate protocols", () => {
  const p = parsePermissions(parse(V2_YAML));
  assert.ok(p.network);
  assert.equal(p.network.default, "ask");
  assert.deepEqual(p.network.deny, ["http://*"]);
});

test("network patterns without a protocol are rejected", () => {
  assert.throws(
    () =>
      parsePermissions({
        policy: { precedence: "deny_over_allow" },
        filesystem: { edit: "allow", write: "allow" },
        shell: { default: "ask" },
        network: { default: "ask", allow: ["api.github.com/*"] }
      }),
    /must start with a protocol/
  );
});

// --- Env ---------------------------------------------------------------------

test("v2 env name patterns parse", () => {
  const p = parsePermissions(parse(V2_YAML));
  assert.ok(p.env);
  assert.equal(p.env.default, "deny");
  assert.deepEqual(p.env.allow, ["NODE_ENV", "GITHUB_*"]);
});

test("env patterns containing = are rejected", () => {
  assert.throws(
    () =>
      parsePermissions({
        policy: { precedence: "deny_over_allow" },
        filesystem: { edit: "allow", write: "allow" },
        shell: { default: "ask" },
        env: { default: "deny", allow: ["NODE_ENV=production"] }
      }),
    /must be a name only/
  );
});

// --- MCP ---------------------------------------------------------------------

test("v2 mcp server:tool patterns parse", () => {
  const p = parsePermissions(parse(V2_YAML));
  assert.ok(p.mcp);
  assert.deepEqual(p.mcp.allow, ["filesystem:*", "postgres:query"]);
  assert.deepEqual(p.mcp.deny, ["postgres:drop_table"]);
});

test("mcp patterns not in server:tool form are rejected", () => {
  assert.throws(
    () =>
      parsePermissions({
        policy: { precedence: "deny_over_allow" },
        filesystem: { edit: "allow", write: "allow" },
        shell: { default: "ask" },
        mcp: { default: "ask", allow: ["justaserver"] }
      }),
    /must be "<server>:<tool>" or "<server>:\*"/
  );
});

// --- Overlap detection -------------------------------------------------------

test("a pattern in both allow and deny of a capability is rejected", () => {
  assert.throws(
    () =>
      parsePermissions({
        policy: { precedence: "deny_over_allow" },
        filesystem: { edit: "allow", write: "allow" },
        shell: { default: "ask" },
        mcp: { default: "ask", allow: ["postgres:query"], deny: ["postgres:query"] }
      }),
    /contradictory mcp patterns/
  );
});

test("a pattern in both allow and ask of a capability is rejected", () => {
  assert.throws(
    () =>
      parsePermissions({
        version: 2,
        policy: { precedence: "deny_over_allow" },
        filesystem: {
          write: { default: "allow", allow: ["src/**"], ask: ["src/**"] }
        },
        shell: { default: "ask" }
      }),
    /contradictory filesystem.write patterns/
  );
});

// --- Kiro rendering ----------------------------------------------------------

test("Kiro renders v2 fs_read path rules (deny → default)", () => {
  const p = parsePermissions(parse(V2_YAML));
  const parsed = parse(renderKiro(p)) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const fsReadDeny = parsed.rules.find((r) => r.capability === "fs_read" && r.effect === "deny");
  assert.ok(fsReadDeny, "must have an fs_read deny rule");
  assert.deepEqual(fsReadDeny.match, [".env*", "**/*.pem"]);
  const fsReadDefault = parsed.rules.find(
    (r) => r.capability === "fs_read" && r.effect === "allow" && r.match === undefined
  );
  assert.ok(fsReadDefault, "must have an fs_read default (allow) rule");
});

test("Kiro renders v2 fs_write ask + deny + default", () => {
  const p = parsePermissions(parse(V2_YAML));
  const parsed = parse(renderKiro(p)) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const ask = parsed.rules.find((r) => r.capability === "fs_write" && r.effect === "ask");
  assert.deepEqual(ask?.match, ["*.config.*"]);
  const deny = parsed.rules.find((r) => r.capability === "fs_write" && r.effect === "deny");
  assert.deepEqual(deny?.match, [".git/**"]);
});

test("Kiro renders network as web_search and web_fetch capabilities", () => {
  const p = parsePermissions(parse(V2_YAML));
  const parsed = parse(renderKiro(p)) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const webSearch = parsed.rules.filter((r) => r.capability === "web_search");
  const webFetch = parsed.rules.filter((r) => r.capability === "web_fetch");
  assert.ok(webSearch.length > 0, "must emit web_search rules");
  assert.ok(webFetch.length > 0, "must emit web_fetch rules");
  const fetchDeny = webFetch.find((r) => r.effect === "deny");
  assert.deepEqual(fetchDeny?.match, ["http://*"]);
  // web_search and web_fetch must not share array references (no YAML anchors).
  assert.ok(!renderKiro(p).includes(" &a"), "output must not contain YAML anchors");
  assert.ok(!renderKiro(p).includes(" *a"), "output must not contain YAML aliases");
});

test("Kiro renders mcp capability rules", () => {
  const p = parsePermissions(parse(V2_YAML));
  const parsed = parse(renderKiro(p)) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const mcpAllow = parsed.rules.find((r) => r.capability === "mcp" && r.effect === "allow");
  assert.deepEqual(mcpAllow?.match, ["filesystem:*", "postgres:query"]);
  const mcpDeny = parsed.rules.find((r) => r.capability === "mcp" && r.effect === "deny");
  assert.deepEqual(mcpDeny?.match, ["postgres:drop_table"]);
});

test("Kiro emits an advisory comment for env (not natively enforceable)", () => {
  const p = parsePermissions(parse(V2_YAML));
  const output = renderKiro(p);
  assert.match(output, /env access is advisory in Kiro/);
  assert.match(output, /NODE_ENV/);
  assert.match(output, /\*_TOKEN/);
});

test("Kiro v1 rendering is unchanged (no v2 sections)", () => {
  const p = parsePermissions(parse(V1_YAML));
  const parsed = parse(renderKiro(p)) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  // fs_read allow **, fs_write allow **, shell deny, shell allow, shell default = 5
  assert.equal(parsed.rules.length, 5);
  assert.deepEqual(parsed.rules[0], { capability: "fs_read", effect: "allow", match: ["**"] });
  assert.ok(!renderKiro(p).includes("web_fetch"));
  assert.ok(!renderKiro(p).includes("env access is advisory"));
});
