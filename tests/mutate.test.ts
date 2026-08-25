import test from "node:test";
import assert from "node:assert/strict";
import { addPattern, loadDocument, removePattern } from "../src/mutate";

const baseYaml = `# Permissions config
policy:
  precedence: deny_over_allow

filesystem:
  edit: allow
  write: allow

shell:
  default: ask
  allow:
    - "git *"
    - "pnpm *"
  deny:
    - "rm -rf /"
`;

test("addPattern appends to the allow list", () => {
  const doc = loadDocument(baseYaml);
  addPattern(doc, "allow", "npm test *");
  const output = doc.toString();
  assert.ok(output.includes("npm test *"));
  assert.ok(output.includes("git *"));
  assert.ok(output.includes("pnpm *"));
});

test("addPattern appends to the deny list", () => {
  const doc = loadDocument(baseYaml);
  addPattern(doc, "deny", "sudo *");
  const output = doc.toString();
  assert.ok(output.includes("sudo *"));
  assert.ok(output.includes("rm -rf /"));
});

test("addPattern rejects empty pattern", () => {
  const doc = loadDocument(baseYaml);
  assert.throws(() => addPattern(doc, "allow", ""), /Pattern must not be empty/);
  assert.throws(() => addPattern(doc, "allow", "   "), /Pattern must not be empty/);
});

test("addPattern rejects duplicate in same list", () => {
  const doc = loadDocument(baseYaml);
  assert.throws(() => addPattern(doc, "allow", "git *"), /already exists in shell\.allow/);
});

test("addPattern rejects pattern existing in opposite list (contradiction)", () => {
  const doc = loadDocument(baseYaml);
  assert.throws(
    () => addPattern(doc, "allow", "rm -rf /"),
    /exists in shell\.deny — remove it first/
  );
  assert.throws(() => addPattern(doc, "deny", "git *"), /exists in shell\.allow — remove it first/);
});

test("addPattern handles multiple patterns sequentially", () => {
  const doc = loadDocument(baseYaml);
  addPattern(doc, "allow", "cargo build *");
  addPattern(doc, "allow", "docker build *");
  const output = doc.toString();
  assert.ok(output.includes("cargo build *"));
  assert.ok(output.includes("docker build *"));
});

test("removePattern removes from the allow list", () => {
  const doc = loadDocument(baseYaml);
  const removed = removePattern(doc, "allow", "git *");
  assert.equal(removed, true);
  const output = doc.toString();
  assert.ok(!output.includes("git *"));
  assert.ok(output.includes("pnpm *"));
});

test("removePattern removes from the deny list", () => {
  const doc = loadDocument(baseYaml);
  const removed = removePattern(doc, "deny", "rm -rf /");
  assert.equal(removed, true);
  const output = doc.toString();
  assert.ok(!output.includes("rm -rf /"));
});

test("removePattern returns false for non-existent pattern", () => {
  const doc = loadDocument(baseYaml);
  const removed = removePattern(doc, "allow", "nonexistent *");
  assert.equal(removed, false);
});

test("removePattern rejects empty pattern", () => {
  const doc = loadDocument(baseYaml);
  assert.throws(() => removePattern(doc, "allow", ""), /Pattern must not be empty/);
});

test("loadDocument preserves comments on round-trip", () => {
  const doc = loadDocument(baseYaml);
  const output = doc.toString();
  assert.ok(output.includes("# Permissions config"));
});

test("addPattern preserves comments after mutation", () => {
  const doc = loadDocument(baseYaml);
  addPattern(doc, "allow", "npm test *");
  const output = doc.toString();
  assert.ok(output.includes("# Permissions config"));
});

test("addPattern works with empty allow list", () => {
  const yaml = `policy:
  precedence: deny_over_allow

filesystem:
  edit: allow
  write: allow

shell:
  default: ask
  allow: []
  deny: []
`;
  const doc = loadDocument(yaml);
  addPattern(doc, "allow", "npm test *");
  const output = doc.toString();
  assert.ok(output.includes("npm test *"));
});

test("removePattern works when list becomes empty", () => {
  const yaml = `policy:
  precedence: deny_over_allow

filesystem:
  edit: allow
  write: allow

shell:
  default: ask
  allow:
    - "only one"
  deny: []
`;
  const doc = loadDocument(yaml);
  const removed = removePattern(doc, "allow", "only one");
  assert.equal(removed, true);
  const output = doc.toString();
  assert.ok(!output.includes("only one"));
});

test("addPattern handles patterns with special YAML characters", () => {
  const doc = loadDocument(baseYaml);
  addPattern(doc, "allow", "echo #comment");
  addPattern(doc, "allow", "key: value");
  const output = doc.toString();
  assert.ok(output.includes("echo #comment"));
  assert.ok(output.includes("key: value"));
});
