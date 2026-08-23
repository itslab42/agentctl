import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "oxc-minify";

const outputDirectory = "dist";
const options = {
  compress: { target: "node18" },
  mangle: { toplevel: true },
  codegen: { removeWhitespace: true }
};

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

function splitShebang(source) {
  if (!source.startsWith("#!")) return { shebang: "", code: source };
  const end = source.indexOf("\n");
  return { shebang: `${source.slice(0, end)}\n`, code: source.slice(end + 1) };
}

for (const path of await javascriptFiles(outputDirectory)) {
  const source = await readFile(path, "utf8");
  const { shebang, code } = splitShebang(source);
  const result = await minify(path, code, options);
  if (result.errors.length > 0) {
    throw new Error(`Could not minify ${path}: ${result.errors.map(String).join("; ")}`);
  }
  await writeFile(path, `${shebang}${result.code}\n`, "utf8");
}
