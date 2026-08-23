"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfig = parseConfig;
exports.loadSource = loadSource;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const yaml_1 = require("yaml");
const permissions_1 = require("./permissions");
function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value;
}
function string(value, label) {
    if (typeof value !== "string")
        throw new Error(`${label} must be a string`);
    return value;
}
function bool(value, label) {
    if (typeof value !== "boolean")
        throw new Error(`${label} must be a boolean`);
    return value;
}
function runtime(raw, name) {
    const value = object(raw[name], `runtimes.${name}`);
    return { enabled: bool(value.enabled, `runtimes.${name}.enabled`) };
}
function parseConfig(raw) {
    const root = object(raw, "config");
    const project = object(root.project, "project");
    const agents = object(root.agents, "agents");
    const runtimes = object(root.runtimes, "runtimes");
    const sync = object(root.sync, "sync");
    const files = object(root.files, "files");
    return {
        project: { name: string(project.name, "project.name") },
        agents: { default: string(agents.default, "agents.default") },
        runtimes: { claude: runtime(runtimes, "claude"), codex: runtime(runtimes, "codex"), opencode: runtime(runtimes, "opencode") },
        sync: { permissions: bool(sync.permissions, "sync.permissions"), agents: bool(sync.agents, "sync.agents") },
        files: {
            permissions: string(files.permissions, "files.permissions"),
            agents: string(files.agents, "files.agents"), rules: string(files.rules, "files.rules"), workflows: string(files.workflows, "files.workflows")
        }
    };
}
async function yamlFile(path) {
    try {
        return (0, yaml_1.parse)(await (0, promises_1.readFile)(path, "utf8"));
    }
    catch (error) {
        throw new Error(`Cannot parse ${path}: ${error.message}`);
    }
}
async function loadSource(root) {
    const configPath = (0, node_path_1.resolve)(root, ".ai/config.yaml");
    const config = parseConfig(await yamlFile(configPath));
    const permissions = (0, permissions_1.parsePermissions)(await yamlFile((0, node_path_1.resolve)(root, config.files.permissions)));
    return { config, permissions };
}
