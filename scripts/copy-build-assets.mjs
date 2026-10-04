import { cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await cp(
  join(root, "src", "recipes", "recipeSeed.json"),
  join(root, "dist", "recipes", "recipeSeed.json")
);
await cp(
  join(root, "src", "nutrition", "nutritionCatalog.json"),
  join(root, "dist", "nutrition", "nutritionCatalog.json")
);
