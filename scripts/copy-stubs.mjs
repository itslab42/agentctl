import { cp, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dest = resolve(root, "../dist/stubs");
await rm(dest, { recursive: true, force: true });
await cp(resolve(root, "../src/stubs"), dest, { recursive: true });
