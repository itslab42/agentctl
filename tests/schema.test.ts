import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

// When compiled, __dirname = <project>/dist-test/tests/
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const SCHEMAS_DIR = resolve(PROJECT_ROOT, "schemas");
const STUBS_DIR = resolve(PROJECT_ROOT, "src", "stubs");

type JsonSchema = Record<string, unknown>;

function loadJson(path: string): JsonSchema {
  return JSON.parse(readFileSync(path, "utf8")) as JsonSchema;
}

function loadYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}

/**
 * Minimal JSON Schema (draft-07 subset) validator. Supports only the keywords
 * used by the agentctl schemas: type, required, properties, additionalProperties
 * (boolean or schema), enum, const, items, minLength, minProperties, uniqueItems,
 * allOf, oneOf, not, if/then/else, and $ref (local "#/definitions/..." only).
 */
function validate(data: unknown, schema: JsonSchema, root: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];

  if (typeof schema.$ref === "string") {
    return validate(data, resolveRef(schema.$ref, root), root, path);
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf as JsonSchema[]) {
      errors.push(...validate(data, sub, root, path));
    }
  }

  if (isPlainObject(schema.not) && validate(data, schema.not, root, path).length === 0) {
    errors.push(`${path}: matched disallowed schema`);
  }

  if (isPlainObject(schema.if)) {
    const branch = validate(data, schema.if, root, path).length === 0 ? schema.then : schema.else;
    if (isPlainObject(branch)) errors.push(...validate(data, branch, root, path));
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as JsonSchema[]).filter(
      (sub) => validate(data, sub, root, path).length === 0
    );
    if (matches.length !== 1) {
      errors.push(
        `${path}: expected to match exactly one schema in oneOf, matched ${matches.length}`
      );
    }
    return errors;
  }

  const type = schema.type as string | undefined;
  if (type && !matchesType(data, type)) {
    errors.push(`${path}: expected type ${type}, got ${jsType(data)}`);
    return errors;
  }

  if ("const" in schema && data !== schema.const) {
    errors.push(
      `${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`
    );
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push(`${path}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (type === "string" && typeof data === "string") {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.items) {
      data.forEach((item, i) => {
        errors.push(...validate(item, schema.items as JsonSchema, root, `${path}[${i}]`));
      });
    }
    if (schema.uniqueItems === true) {
      const seen = data.map((v) => JSON.stringify(v));
      if (new Set(seen).size !== seen.length) errors.push(`${path}: array items not unique`);
    }
  }

  if (isPlainObject(data)) {
    const obj = data as Record<string, unknown>;
    const props = (schema.properties as Record<string, JsonSchema>) ?? {};

    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) errors.push(`${path}: missing required property "${key}"`);
      }
    }

    if (
      typeof schema.minProperties === "number" &&
      Object.keys(obj).length < schema.minProperties
    ) {
      errors.push(`${path}: fewer than minProperties ${schema.minProperties}`);
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key in props) {
        errors.push(...validate(value, props[key], root, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: additional property "${key}" is not allowed`);
      } else if (isPlainObject(schema.additionalProperties)) {
        errors.push(
          ...validate(value, schema.additionalProperties as JsonSchema, root, `${path}.${key}`)
        );
      }
    }
  }

  return errors;
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
  let current: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) throw new Error(`unresolved $ref: ${ref}`);
  }
  return current as JsonSchema;
}

function matchesType(data: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isPlainObject(data);
    case "array":
      return Array.isArray(data);
    case "string":
      return typeof data === "string";
    case "number":
      return typeof data === "number" && Number.isFinite(data);
    case "integer":
      return typeof data === "number" && Number.isInteger(data);
    case "boolean":
      return typeof data === "boolean";
    default:
      return false;
  }
}

function jsType(data: unknown): string {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  return typeof data;
}

function isPlainObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

test("config stub validates against config.schema.json", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "config.schema.json"));
  const raw = readFileSync(resolve(STUBS_DIR, "config.yaml"), "utf8").replace(
    "__PROJECT_NAME__",
    "example-project"
  );
  const data = parse(raw);
  assert.deepEqual(validate(data, schema, schema), []);
});

test("permissions stub validates against permissions.schema.json", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "permissions.schema.json"));
  const data = loadYaml(resolve(STUBS_DIR, "permissions.yaml"));
  assert.deepEqual(validate(data, schema, schema), []);
});

test("a representative mcp config validates against mcp.schema.json", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "mcp.schema.json"));
  const data = {
    servers: {
      filesystem: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: { API_KEY: "${API_KEY}" }
      },
      "my-api": {
        transport: "streamable-http",
        url: "http://localhost:3001/mcp"
      }
    }
  };
  assert.deepEqual(validate(data, schema, schema), []);
});

test("mcp schema rejects stdio server missing command", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "mcp.schema.json"));
  const data = { servers: { bad: { transport: "stdio" } } };
  assert.notEqual(validate(data, schema, schema).length, 0);
});

test("mcp schema rejects streamable-http server missing url", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "mcp.schema.json"));
  const data = {
    servers: { bad: { transport: "streamable-http" } }
  };
  assert.notEqual(validate(data, schema, schema).length, 0);
});

test("mcp schema rejects unknown transport", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "mcp.schema.json"));
  const data = {
    servers: { bad: { transport: "carrier-pigeon" } }
  };
  assert.notEqual(validate(data, schema, schema).length, 0);
});

// additionalProperties is intentionally permissive per SchemaStore guidance:
// unknown fields (e.g. a future tool option) must NOT error. Transport routing
// is enforced by the `transport` const in each oneOf branch, and required
// fields (command for stdio, url for streamable-http) are still enforced.
test("mcp schema tolerates unknown extra fields on a server", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "mcp.schema.json"));
  const data = {
    servers: { ok: { transport: "stdio", command: "npx", futureOption: true } }
  };
  assert.deepEqual(validate(data, schema, schema), []);
});

test("config schema rejects non-boolean runtime enabled", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "config.schema.json"));
  const data = {
    project: { name: "x" },
    runtimes: { kiro: { enabled: "yes" } },
    sync: { permissions: true },
    files: { permissions: ".ai/permissions.yaml" }
  };
  assert.notEqual(validate(data, schema, schema).length, 0);
});

test("permissions schema rejects invalid permission value", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "permissions.schema.json"));
  const data = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "maybe", write: "allow" },
    shell: { default: "ask" }
  };
  assert.notEqual(validate(data, schema, schema).length, 0);
});

test("permissions schema requires version 2 for capability fields", () => {
  const schema = loadJson(resolve(SCHEMAS_DIR, "permissions.schema.json"));
  const base = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask" }
  };
  const v2 = {
    ...base,
    version: 2,
    network: { default: "ask" },
    env: { default: "deny" },
    mcp: { default: "ask" }
  };

  assert.deepEqual(validate(v2, schema, schema), []);
  assert.deepEqual(
    validate({ ...base, filesystem: { read: "ask", write: "allow" } }, schema, schema),
    []
  );
  assert.notEqual(validate({ ...v2, version: 1 }, schema, schema).length, 0);
  const { version: _version, ...implicitV1 } = v2;
  assert.notEqual(validate(implicitV1, schema, schema).length, 0);
  assert.notEqual(
    validate(
      { ...base, filesystem: { read: { default: "allow" }, write: "allow" } },
      schema,
      schema
    ).length,
    0
  );
});

test("all schema files are valid JSON with draft-07 declaration", () => {
  for (const file of ["config.schema.json", "permissions.schema.json", "mcp.schema.json"]) {
    const schema = loadJson(resolve(SCHEMAS_DIR, file));
    assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#", `${file} $schema`);
    assert.ok(typeof schema.title === "string" && schema.title.length > 0, `${file} title`);
  }
});
