import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GENERATED_MARKER } from "./permissions";

export interface InstructionBlock {
  runtimes: string[];
  content: string;
}

export interface Instructions {
  common: string;
  blocks: InstructionBlock[];
}

/**
 * Parses `.ai/instructions.md` content. Supports conditional blocks:
 *   <!-- agentctl:only claude codex -->
 *   ...content...
 *   <!-- agentctl:end -->
 */
export function parseInstructions(raw: string): Instructions {
  const blockRegex = /<!--\s*agentctl:only\s+([\w\s]+?)\s*-->([\s\S]*?)<!--\s*agentctl:end\s*-->/g;
  const blocks: InstructionBlock[] = [];
  let common = raw;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(raw)) !== null) {
    const runtimes = match[1].trim().split(/\s+/);
    const content = match[2].trim();
    blocks.push({ runtimes, content });
  }

  // Remove conditional blocks from common content
  common = common.replace(blockRegex, "").trim();

  return { common, blocks };
}

/**
 * Resolves the final instruction content for a specific runtime.
 * Combines common content with any runtime-specific blocks.
 */
export function resolveForRuntime(instructions: Instructions, runtime: string): string {
  const parts: string[] = [instructions.common];
  for (const block of instructions.blocks) {
    if (block.runtimes.includes(runtime)) {
      parts.push(block.content);
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Header comment appended to generated instruction files. */
const HEADER = `<!-- ${GENERATED_MARKER} -->`;

/** Renders instructions for Claude → `CLAUDE.md` */
export function renderClaudeInstructions(content: string): string {
  return `${HEADER}\n\n${content}\n`;
}

/** Renders instructions for Codex → `AGENTS.md` */
export function renderCodexInstructions(content: string): string {
  return `${HEADER}\n\n${content}\n`;
}

/** Renders instructions for Cursor → `.cursor/rules/agentctl-instructions/RULE.md` */
export function renderCursorInstructions(content: string): string {
  return `---
description: "Project instructions managed by agentctl"
alwaysApply: true
---

${HEADER}

${content}
`;
}

/** Renders instructions for Kiro → `.kiro/steering/agentctl-instructions.md` */
export function renderKiroInstructions(content: string): string {
  return `---
inclusion: always
name: "Project Instructions"
description: "Core project instructions managed by agentctl"
---

${HEADER}

${content}
`;
}

/** Renders instructions for OpenCode → `AGENTS.md` (same as Codex) */
export function renderOpenCodeInstructions(content: string): string {
  return `${HEADER}\n\n${content}\n`;
}

/** Loads and parses instructions from a file path relative to the project root. */
export async function loadInstructions(root: string, filePath: string): Promise<Instructions> {
  const fullPath = resolve(root, filePath);
  const raw = await readFile(fullPath, "utf8");
  return parseInstructions(raw);
}
