import { cp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
await cp(resolve(root, "../src/stubs"), resolve(root, "../dist/stubs"), { recursive: true });
