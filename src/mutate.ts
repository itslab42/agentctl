import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Document, parseDocument, YAMLSeq } from "yaml";

export interface MutateOptions {
  dryRun?: boolean;
}

export interface MutateResult {
  changed: boolean;
  content: string;
}

function getShellSeq(doc: Document, list: "allow" | "deny"): YAMLSeq {
  const seq = doc.getIn(["shell", list], true);
  if (!(seq instanceof YAMLSeq)) {
    throw new Error(`shell.${list} is not a sequence in permissions.yaml`);
  }
  return seq;
}

function seqValues(seq: YAMLSeq): string[] {
  return seq.items.map((item) => {
    if (typeof item === "object" && item !== null && "value" in item) {
      return String((item as { value: unknown }).value);
    }
    return String(item);
  });
}

export function addPattern(doc: Document, list: "allow" | "deny", pattern: string): void {
  if (!pattern || pattern.trim().length === 0) {
    throw new Error("Pattern must not be empty");
  }
  const opposite = list === "allow" ? "deny" : "allow";
  const oppositeSeq = getShellSeq(doc, opposite);
  const oppositeValues = seqValues(oppositeSeq);
  if (oppositeValues.includes(pattern)) {
    throw new Error(`Pattern "${pattern}" exists in shell.${opposite} — remove it first`);
  }
  const seq = getShellSeq(doc, list);
  const values = seqValues(seq);
  if (values.includes(pattern)) {
    throw new Error(`Pattern "${pattern}" already exists in shell.${list}`);
  }
  seq.add(pattern);
}

export function removePattern(doc: Document, list: "allow" | "deny", pattern: string): boolean {
  if (!pattern || pattern.trim().length === 0) {
    throw new Error("Pattern must not be empty");
  }
  const seq = getShellSeq(doc, list);
  const values = seqValues(seq);
  const index = values.indexOf(pattern);
  if (index === -1) {
    return false;
  }
  seq.delete(index);
  return true;
}

export function loadDocument(content: string): Document {
  return parseDocument(content, { keepSourceTokens: true });
}

export async function mutatePermissions(
  root: string,
  permissionsPath: string,
  action: (doc: Document) => void,
  options: MutateOptions = {}
): Promise<MutateResult> {
  const fullPath = resolve(root, permissionsPath);
  const raw = await readFile(fullPath, "utf8");
  const doc = loadDocument(raw);
  action(doc);
  const content = doc.toString();
  if (!options.dryRun && content !== raw) {
    await writeFile(fullPath, content, "utf8");
  }
  return { changed: content !== raw, content };
}
