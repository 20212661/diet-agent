import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src", "recipes", "recipeSeed.json");
const target = resolve(root, "dist", "recipes", "recipeSeed.json");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
