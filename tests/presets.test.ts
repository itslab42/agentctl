import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { presets, renderPreset, listPresetNames } from "../src/presets";
import { parsePermissions } from "../src/permissions";

test("listPresetNames returns all three presets", () => {
  const names = listPresetNames();
  assert.deepEqual(names, ["readonly", "standard", "trusted"]);
});

test("readonly preset has deny filesystem and deny shell default", () => {
  const preset = presets.readonly;
  assert.equal(preset.permissions.filesystem.edit, "deny");
  assert.equal(preset.permissions.filesystem.write, "deny");
  assert.equal(preset.permissions.shell.default, "deny");
  assert.ok(preset.permissions.shell.allow.length > 0, "should have allow patterns");
  assert.equal(preset.permissions.shell.deny.length, 0, "should have no deny patterns");
});

test("standard preset has allow filesystem and ask shell default", () => {
  const preset = presets.standard;
  assert.equal(preset.permissions.filesystem.edit, "allow");
  assert.equal(preset.permissions.filesystem.write, "allow");
  assert.equal(preset.permissions.shell.default, "ask");
  assert.ok(preset.permissions.shell.allow.length > 0);
  assert.ok(preset.permissions.shell.deny.length > 0);
});

test("trusted preset has allow filesystem and allow shell default", () => {
  const preset = presets.trusted;
  assert.equal(preset.permissions.filesystem.edit, "allow");
  assert.equal(preset.permissions.filesystem.write, "allow");
  assert.equal(preset.permissions.shell.default, "allow");
  assert.equal(preset.permissions.shell.allow.length, 0, "should have no allow patterns");
  assert.ok(preset.permissions.shell.deny.length > 0, "should still block catastrophic commands");
});

test("renderPreset produces valid YAML for all presets", () => {
  for (const [name, preset] of Object.entries(presets)) {
    const yaml = renderPreset(preset);
    const parsed = parse(yaml) as unknown;
    assert.ok(parsed, `${name} preset should produce parseable YAML`);
  }
});

test("renderPreset output passes parsePermissions validation", () => {
  for (const [name, preset] of Object.entries(presets)) {
    const yaml = renderPreset(preset);
    const parsed = parse(yaml) as unknown;
    const permissions = parsePermissions(parsed);
    assert.equal(
      permissions.policy.precedence,
      "deny_over_allow",
      `${name} should have deny_over_allow`
    );
    assert.equal(permissions.filesystem.edit, preset.permissions.filesystem.edit);
    assert.equal(permissions.filesystem.write, preset.permissions.filesystem.write);
    assert.equal(permissions.shell.default, preset.permissions.shell.default);
  }
});

test("presets have no contradictory allow/deny patterns", () => {
  for (const [name, preset] of Object.entries(presets)) {
    const overlap = preset.permissions.shell.allow.filter((p) =>
      preset.permissions.shell.deny.includes(p)
    );
    assert.equal(overlap.length, 0, `${name} has contradictory patterns: ${overlap.join(", ")}`);
  }
});

test("renderPreset is deterministic", () => {
  for (const preset of Object.values(presets)) {
    assert.equal(renderPreset(preset), renderPreset(preset));
  }
});

test("each preset has a name and description", () => {
  for (const preset of Object.values(presets)) {
    assert.ok(preset.name.length > 0);
    assert.ok(preset.description.length > 0);
  }
});
