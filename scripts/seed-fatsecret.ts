/**
 * 从 FatSecret API 拉取常见中国菜品，缓存到 SQLite
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(import.meta.dirname, "..", "data");
const DB_PATH = join(DB_DIR, "diet-agent.sqlite");

const CLIENT_ID = process.env.FATSECRET_CLIENT_ID || "4c095531df124880ad1eb3ddce30d587";
const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET || "5afb5e0fcc5344449c016b9aca0c1380";

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_URL = "https://platform.fatsecret.com/rest/server.api";

let token = "";
let tokenExp = 0;

async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=basic",
  });
  if (!resp.ok) throw new Error(`Token error ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as any;
  token = data.access_token;
  tokenExp = Date.now() + (data.expires_in - 300) * 1000;
  console.log("Token obtained");
  return token;
}

async function apiCall(method: string, params: Record<string, string>) {
  const t = await getToken();
  const body = new URLSearchParams({ method, format: "json", region: "0", language: "0", ...params });
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${t}` },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function toArr(val: any): any[] {
  return !val ? [] : Array.isArray(val) ? val : [val];
}

const QUERIES = [
  "番茄炒蛋", "宫保鸡丁", "麻婆豆腐", "红烧肉", "糖醋排骨",
  "鱼香肉丝", "回锅肉", "水煮鱼", "酸菜鱼", "红烧鱼",
  "清蒸鲈鱼", "可乐鸡翅", "辣子鸡", "蒜蓉西兰花", "土豆丝",
  "干煸四季豆", "木须肉", "青椒肉丝", "蚂蚁上树", "东坡肉",
  "京酱肉丝", "蒜苔炒肉", "西红柿鸡蛋", "醋溜白菜",
  "红烧茄子", "地三鲜", "锅包肉", "小炒肉",
  "紫菜蛋花汤", "番茄蛋汤", "酸辣汤", "皮蛋瘦肉粥", "小米粥",
  "排骨汤", "鸡汤", "玉米排骨汤",
  "蛋炒饭", "炒面", "炸酱面", "饺子", "馄饨",
  "葱油拌面", "煎饼", "包子",
  "鸡胸肉", "猪肉", "牛肉", "鸡蛋", "豆腐",
  "米饭", "面条", "土豆", "番茄", "西兰花",
  "胡萝卜", "白菜", "黄瓜", "香菇", "虾",
  "三文鱼", "牛奶", "酸奶", "苹果", "香蕉",
];

async function main() {
  await getToken();

  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS fatsecret_foods (
      food_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      calories REAL,
      protein REAL,
      carbs REAL,
      fat REAL,
      serving TEXT,
      search_query TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fatsecret_recipes (
      recipe_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      url TEXT,
      search_query TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const insertFood = db.prepare(`
    INSERT OR IGNORE INTO fatsecret_foods (food_id, name, description, calories, protein, carbs, fat, serving, search_query, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRecipe = db.prepare(`
    INSERT OR IGNORE INTO fatsecret_recipes (recipe_id, name, description, url, search_query, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let totalFoods = 0;
  let totalRecipes = 0;
  const now = new Date().toISOString();

  for (const query of QUERIES) {
    try {
      const foodData = await apiCall("foods.search", { search_expression: query, max_results: "5" });
      const foods = toArr(foodData?.foods?.food);

      for (const f of foods.slice(0, 2)) {
        try {
          const detail = await apiCall("food.get.v4", { food_id: f.food_id });
          const servings = detail?.food?.servings?.serving;
          if (!servings) continue;
          const s = Array.isArray(servings) ? servings[0] : servings;
          insertFood.run(
            f.food_id, f.food_name, f.food_description || null,
            parseFloat(s.calories) || null,
            parseFloat(s.protein) || null,
            parseFloat(s.carbohydrate) || null,
            parseFloat(s.fat) || null,
            s.serving_description || null,
            query, now,
          );
          totalFoods++;
        } catch (e: any) {
          console.warn(`  food.get ${f.food_id}: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      try {
        const recipeData = await apiCall("recipes.search.v2", { search_expression: query, max_results: "3" });
        const recipes = toArr(recipeData?.recipes?.recipe);
        for (const r of recipes) {
          insertRecipe.run(r.recipe_id, r.recipe_name, r.recipe_description || null, r.recipe_url || null, query, now);
          totalRecipes++;
        }
      } catch (e: any) {
        console.warn(`  recipes "${query}": ${e.message}`);
      }

      process.stdout.write(`\r${QUERIES.indexOf(query) + 1}/${QUERIES.length} "${query}": ${totalFoods} foods, ${totalRecipes} recipes`);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e: any) {
      console.warn(`\n"${query}": ${e.message}`);
    }
  }

  db.close();
  console.log(`\nDone! ${totalFoods} foods, ${totalRecipes} recipes cached.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
