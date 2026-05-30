import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_SKILLS, getSkillMetaBySlug, type SkillMeta } from "./skillRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_ROOT = path.resolve(__dirname);

export async function loadSkillContent(slug: string): Promise<{
  slug: string;
  name: string;
  description: string;
  content: string;
}> {
  const meta = getSkillMetaBySlug(slug);

  if (!meta) {
    throw new Error(`Skill not found or disabled: ${slug}`);
  }

  const filePath = path.resolve(SKILLS_ROOT, meta.relativePath);

  if (!filePath.startsWith(SKILLS_ROOT)) {
    throw new Error(`Invalid skill path: ${slug}`);
  }

  if (!existsSync(filePath)) {
    throw new Error(`Skill file not found: ${slug}`);
  }

  const content = await readFile(filePath, "utf-8");

  return {
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    content,
  };
}

export function getAllSkillMetas(): SkillMeta[] {
  return BUILTIN_SKILLS.filter((s) => s.enabled);
}
