/**
 * Seed FatSecret food data using English queries for accurate results
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(import.meta.dirname, "..", "data");
const DB_PATH = join(DB_DIR, "diet-agent.sqlite");

const CLIENT_ID = "4c095531df124880ad1eb3ddce30d587";
const CLIENT_SECRET = "5afb5e0fcc5344449c016b9aca0c1380";

let token = "";
let tokenExp = 0;

async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const resp = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=basic",
  });
  const data = (await resp.json()) as any;
  token = data.access_token;
  tokenExp = Date.now() + (data.expires_in - 300) * 1000;
  return token;
}

async function apiCall(method: string, params: Record<string, string>) {
  const t = await getToken();
  const body = new URLSearchParams({ method, format: "json", ...params });
  const resp = await fetch("https://platform.fatsecret.com/rest/server.api", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${t}` },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json();
}

function toArr(val: any): any[] { return !val ? [] : Array.isArray(val) ? val : [val]; }

// English queries with Chinese labels
const QUERIES: { en: string; zh: string }[] = [
  // === 肉类 ===
  { en: "chicken breast", zh: "鸡胸肉" },
  { en: "chicken thigh", zh: "鸡腿" },
  { en: "chicken wing", zh: "鸡翅" },
  { en: "chicken drumstick", zh: "鸡腿" },
  { en: "whole chicken", zh: "整鸡" },
  { en: "chicken liver", zh: "鸡肝" },
  { en: "chicken feet", zh: "鸡爪" },
  { en: "duck breast", zh: "鸭胸" },
  { en: "duck leg", zh: "鸭腿" },
  { en: "pork belly", zh: "五花肉" },
  { en: "pork chop", zh: "猪排" },
  { en: "pork tenderloin", zh: "猪里脊" },
  { en: "pork ribs", zh: "排骨" },
  { en: "pork loin", zh: "猪腰肉" },
  { en: "pork shoulder", zh: "猪肩肉" },
  { en: "ground pork", zh: "猪肉馅" },
  { en: "pork liver", zh: "猪肝" },
  { en: "beef steak", zh: "牛排" },
  { en: "beef tenderloin", zh: "牛里脊" },
  { en: "beef brisket", zh: "牛腩" },
  { en: "ground beef", zh: "牛肉馅" },
  { en: "beef ribs", zh: "牛肋排" },
  { en: "beef shank", zh: "牛腱" },
  { en: "lamb chop", zh: "羊排" },
  { en: "lamb leg", zh: "羊腿" },
  { en: "ground lamb", zh: "羊肉馅" },
  { en: "bacon", zh: "培根" },
  { en: "sausage", zh: "香肠" },
  { en: "ham", zh: "火腿" },
  { en: "turkey breast", zh: "火鸡胸" },
  // === 水产 ===
  { en: "shrimp", zh: "虾" },
  { en: "prawn", zh: "大虾" },
  { en: "salmon", zh: "三文鱼" },
  { en: "salmon fillet", zh: "三文鱼柳" },
  { en: "tilapia", zh: "鲈鱼" },
  { en: "cod", zh: "鳕鱼" },
  { en: "tuna", zh: "金枪鱼" },
  { en: "tuna steak", zh: "金枪鱼排" },
  { en: "sea bass", zh: "鲈鱼" },
  { en: "sardine", zh: "沙丁鱼" },
  { en: "mackerel", zh: "鲭鱼" },
  { en: "trout", zh: "鳟鱼" },
  { en: "crab", zh: "螃蟹" },
  { en: "crab meat", zh: "蟹肉" },
  { en: "squid", zh: "鱿鱼" },
  { en: "octopus", zh: "章鱼" },
  { en: "scallop", zh: "扇贝" },
  { en: "clam", zh: "蛤蜊" },
  { en: "oyster", zh: "生蚝" },
  { en: "crawfish", zh: "小龙虾" },
  { en: "fish ball", zh: "鱼丸" },
  // === 蛋奶豆 ===
  { en: "egg", zh: "鸡蛋" },
  { en: "egg white", zh: "蛋白" },
  { en: "egg yolk", zh: "蛋黄" },
  { en: "duck egg", zh: "鸭蛋" },
  { en: "century egg", zh: "皮蛋" },
  { en: "salted egg", zh: "咸蛋" },
  { en: "quail egg", zh: "鹌鹑蛋" },
  { en: "tofu", zh: "豆腐" },
  { en: "silken tofu", zh: "嫩豆腐" },
  { en: "tofu skin", zh: "豆腐皮" },
  { en: "dried tofu", zh: "豆腐干" },
  { en: "tempeh", zh: "天培" },
  { en: "soy milk", zh: "豆浆" },
  { en: "edamame", zh: "毛豆" },
  { en: "milk whole", zh: "全脂牛奶" },
  { en: "milk skim", zh: "脱脂牛奶" },
  { en: "yogurt plain", zh: "原味酸奶" },
  { en: "greek yogurt", zh: "希腊酸奶" },
  { en: "cheese cheddar", zh: "切达奶酪" },
  { en: "cream cheese", zh: "奶油奶酪" },
  { en: "mozzarella", zh: "马苏里拉" },
  { en: "butter", zh: "黄油" },
  { en: "heavy cream", zh: "淡奶油" },
  // === 蔬菜 ===
  { en: "tomato", zh: "番茄" },
  { en: "cherry tomato", zh: "圣女果" },
  { en: "broccoli", zh: "西兰花" },
  { en: "cauliflower", zh: "花菜" },
  { en: "potato", zh: "土豆" },
  { en: "sweet potato", zh: "红薯" },
  { en: "carrot", zh: "胡萝卜" },
  { en: "cabbage", zh: "白菜" },
  { en: "napa cabbage", zh: "大白菜" },
  { en: "cucumber", zh: "黄瓜" },
  { en: "mushroom", zh: "香菇" },
  { en: "shiitake mushroom", zh: "香菇" },
  { en: "button mushroom", zh: "口蘑" },
  { en: "enoki mushroom", zh: "金针菇" },
  { en: "wood ear mushroom", zh: "木耳" },
  { en: "onion", zh: "洋葱" },
  { en: "green onion", zh: "葱" },
  { en: "garlic", zh: "蒜" },
  { en: "ginger", zh: "姜" },
  { en: "green pepper", zh: "青椒" },
  { en: "red pepper", zh: "红椒" },
  { en: "bell pepper", zh: "彩椒" },
  { en: "chili pepper", zh: "辣椒" },
  { en: "spinach", zh: "菠菜" },
  { en: "green beans", zh: "四季豆" },
  { en: "eggplant", zh: "茄子" },
  { en: "celery", zh: "芹菜" },
  { en: "lettuce", zh: "生菜" },
  { en: "bok choy", zh: "小白菜" },
  { en: "bitter melon", zh: "苦瓜" },
  { en: "winter melon", zh: "冬瓜" },
  { en: "zucchini", zh: "西葫芦" },
  { en: "lotus root", zh: "莲藕" },
  { en: "bamboo shoot", zh: "竹笋" },
  { en: "pea", zh: "豌豆" },
  { en: "corn", zh: "玉米" },
  { en: "radish", zh: "萝卜" },
  { en: "daikon", zh: "白萝卜" },
  { en: "bean sprout", zh: "豆芽" },
  { en: "water spinach", zh: "空心菜" },
  { en: "kale", zh: "羽衣甘蓝" },
  { en: "asparagus", zh: "芦笋" },
  { en: "pumpkin", zh: "南瓜" },
  { en: "taro", zh: "芋头" },
  { en: "yam", zh: "山药" },
  { en: "seaweed", zh: "海带" },
  // === 主食 ===
  { en: "white rice", zh: "白米饭" },
  { en: "brown rice", zh: "糙米饭" },
  { en: "rice porridge congee", zh: "粥" },
  { en: "noodles", zh: "面条" },
  { en: "rice noodles", zh: "米粉" },
  { en: "udon noodle", zh: "乌冬面" },
  { en: "soba noodle", zh: "荞麦面" },
  { en: "vermicelli", zh: "粉丝" },
  { en: "bread white", zh: "白面包" },
  { en: "whole wheat bread", zh: "全麦面包" },
  { en: "steamed bun", zh: "馒头" },
  { en: "pancake", zh: "薄饼" },
  { en: "pasta spaghetti", zh: "意大利面" },
  { en: "oatmeal", zh: "燕麦片" },
  { en: "quinoa", zh: "藜麦" },
  // === 水果 ===
  { en: "apple", zh: "苹果" },
  { en: "banana", zh: "香蕉" },
  { en: "orange", zh: "橙子" },
  { en: "grape", zh: "葡萄" },
  { en: "strawberry", zh: "草莓" },
  { en: "blueberry", zh: "蓝莓" },
  { en: "watermelon", zh: "西瓜" },
  { en: "mango", zh: "芒果" },
  { en: "pineapple", zh: "菠萝" },
  { en: "pear", zh: "梨" },
  { en: "peach", zh: "桃子" },
  { en: "kiwi", zh: "猕猴桃" },
  { en: "lemon", zh: "柠檬" },
  { en: "cherry", zh: "樱桃" },
  { en: "pomegranate", zh: "石榴" },
  { en: "coconut", zh: "椰子" },
  { en: "papaya", zh: "木瓜" },
  { en: "dragon fruit", zh: "火龙果" },
  { en: "lychee", zh: "荔枝" },
  { en: "persimmon", zh: "柿子" },
  { en: "avocado", zh: "牛油果" },
  // === 坚果零食 ===
  { en: "peanut", zh: "花生" },
  { en: "almond", zh: "杏仁" },
  { en: "walnut", zh: "核桃" },
  { en: "cashew", zh: "腰果" },
  { en: "pistachio", zh: "开心果" },
  { en: "sunflower seed", zh: "葵花籽" },
  { en: "sesame seed", zh: "芝麻" },
  { en: "chestnut", zh: "板栗" },
  { en: "dark chocolate", zh: "黑巧克力" },
  { en: "raisin", zh: "葡萄干" },
  // === 调料 ===
  { en: "soy sauce", zh: "酱油" },
  { en: "oyster sauce", zh: "蚝油" },
  { en: "fish sauce", zh: "鱼露" },
  { en: "sesame oil", zh: "芝麻油" },
  { en: "olive oil", zh: "橄榄油" },
  { en: "vegetable oil", zh: "植物油" },
  { en: "vinegar", zh: "醋" },
  { en: "honey", zh: "蜂蜜" },
  { en: "sugar", zh: "白糖" },
  { en: "salt", zh: "盐" },
  { en: "black pepper", zh: "黑胡椒" },
  { en: "chili sauce", zh: "辣椒酱" },
  { en: "hoisin sauce", zh: "海鲜酱" },
  { en: "curry paste", zh: "咖喱酱" },
  { en: "miso paste", zh: "味噌" },
  { en: "tahini", zh: "芝麻酱" },
  // === 成品菜 ===
  { en: "fried rice", zh: "炒饭" },
  { en: "egg fried rice", zh: "蛋炒饭" },
  { en: "chicken fried rice", zh: "鸡肉炒饭" },
  { en: "chicken stir fry", zh: "炒鸡" },
  { en: "beef stir fry", zh: "炒牛肉" },
  { en: "pork stir fry", zh: "炒肉" },
  { en: "beef noodle soup", zh: "牛肉面" },
  { en: "wonton soup", zh: "馄饨" },
  { en: "hot and sour soup", zh: "酸辣汤" },
  { en: "egg drop soup", zh: "蛋花汤" },
  { en: "miso soup", zh: "味噌汤" },
  { en: "chicken soup", zh: "鸡汤" },
  { en: "bone broth", zh: "骨头汤" },
  { en: "tomato egg stir fry", zh: "番茄炒蛋" },
  { en: "kung pao chicken", zh: "宫保鸡丁" },
  { en: "sweet and sour pork", zh: "糖醋排骨" },
  { en: "mapo tofu", zh: "麻婆豆腐" },
  { en: "steamed fish", zh: "清蒸鱼" },
  { en: "braised pork", zh: "红烧肉" },
  { en: "stir fry green beans", zh: "干煸四季豆" },
  { en: "potato stir fry", zh: "炒土豆丝" },
  { en: "egg foo young", zh: "芙蓉蛋" },
  { en: "congee", zh: "粥" },
  { en: "dumpling", zh: "饺子" },
  { en: "spring roll", zh: "春卷" },
  { en: "fried chicken", zh: "炸鸡" },
  { en: "peking duck", zh: "北京烤鸭" },
  { en: "char siu", zh: "叉烧" },
  { en: "dim sum", zh: "点心" },
  { en: "lo mein", zh: "捞面" },
  { en: "chow mein", zh: "炒面" },
  { en: "chow fun", zh: "炒河粉" },
  { en: "fried tofu", zh: "煎豆腐" },
  { en: "stinky tofu", zh: "臭豆腐" },
  { en: "scrambled egg", zh: "炒鸡蛋" },
  { en: "boiled egg", zh: "煮鸡蛋" },
  { en: "tea egg", zh: "茶叶蛋" },
  { en: "omelet", zh: "煎蛋卷" },
  { en: "steamed egg", zh: "蒸蛋" },
  { en: "twice cooked pork", zh: "回锅肉" },
  { en: "boiled fish", zh: "水煮鱼" },
  { en: "spicy tofu", zh: "麻辣豆腐" },
  { en: "garlic broccoli", zh: "蒜蓉西兰花" },
  { en: "stir fry cabbage", zh: "炒白菜" },
  { en: "stir fry spinach", zh: "炒菠菜" },
  { en: "stir fry celery", zh: "炒芹菜" },
  { en: "braised eggplant", zh: "红烧茄子" },
  { en: "stir fry bitter melon", zh: "炒苦瓜" },
  { en: "pork belly braised", zh: "红烧五花肉" },
  { en: "cola chicken wing", zh: "可乐鸡翅" },
  { en: "steamed spare ribs", zh: "蒸排骨" },
  { en: "roast pork", zh: "烤肉" },
  { en: "grilled chicken", zh: "烤鸡" },
  { en: "grilled fish", zh: "烤鱼" },
  { en: "hot pot", zh: "火锅" },
  { en: "malatang", zh: "麻辣烫" },
  { en: "claypot rice", zh: "煲仔饭" },
  { en: "curry chicken", zh: "咖喱鸡" },
  { en: "curry beef", zh: "咖喱牛肉" },
  { en: "teriyaki chicken", zh: "照烧鸡" },
  { en: "japanese ramen", zh: "日式拉面" },
  { en: "sushi roll", zh: "寿司卷" },
  { en: "sashimi", zh: "刺身" },
  { en: "onigiri", zh: "饭团" },
  { en: "pad thai", zh: "泰式炒河粉" },
  { en: "pho", zh: "越南粉" },
  { en: "bibimbap", zh: "石锅拌饭" },
  { en: "kimchi", zh: "泡菜" },
  { en: "korean bbq", zh: "韩式烤肉" },
  { en: "korean fried chicken", zh: "韩式炸鸡" },
  { en: "tandoori chicken", zh: "坦都里鸡" },
  { en: "butter chicken", zh: "黄油鸡" },
  { en: "naan", zh: "烤饼" },
  { en: "hummus", zh: "鹰嘴豆泥" },
  { en: "pizza", zh: "披萨" },
  { en: "lasagna", zh: "千层面" },
  { en: "mac and cheese", zh: "芝士通心粉" },
  { en: "hamburger", zh: "汉堡" },
  { en: "sandwich", zh: "三明治" },
  { en: "wrap", zh: "卷饼" },
  { en: "burrito", zh: "墨西哥卷" },
  { en: "taco", zh: "塔可" },
  { en: "french fries", zh: "薯条" },
  { en: "mashed potato", zh: "土豆泥" },
  { en: "baked potato", zh: "烤土豆" },
  { en: "caesar salad", zh: "凯撒沙拉" },
  { en: "garden salad", zh: "蔬菜沙拉" },
  { en: "smoothie", zh: "奶昔" },
  { en: "orange juice", zh: "橙汁" },
  { en: "apple juice", zh: "苹果汁" },
  { en: "green tea", zh: "绿茶" },
  { en: "black tea", zh: "红茶" },
  { en: "coffee black", zh: "黑咖啡" },
  { en: "latte", zh: "拿铁" },
  { en: "cappuccino", zh: "卡布奇诺" },
  { en: "soy sauce chicken", zh: "酱油鸡" },
  { en: "white cut chicken", zh: "白切鸡" },
  { en: "salt baked chicken", zh: "盐焗鸡" },
  { en: "three cup chicken", zh: "三杯鸡" },
  { en: "popcorn chicken", zh: "盐酥鸡" },
  { en: "beef chow fun", zh: "干炒牛河" },
  { en: "rice porridge", zh: "稀饭" },
  { en: "almond milk", zh: "杏仁奶" },
  { en: "coconut milk", zh: "椰奶" },
  { en: "oat milk", zh: "燕麦奶" },
  { en: "protein powder", zh: "蛋白粉" },
];

async function main() {
  await getToken();
  console.log("Token OK");

  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);

  // Clear old data and recreate
  db.exec(`
    CREATE TABLE IF NOT EXISTS fatsecret_foods (
      food_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_zh TEXT,
      description TEXT,
      calories REAL,
      protein REAL,
      carbs REAL,
      fat REAL,
      serving TEXT,
      search_query TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO fatsecret_foods (food_id, name, name_zh, description, calories, protein, carbs, fat, serving, search_query, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(food_id) DO UPDATE SET
      name_zh = COALESCE(excluded.name_zh, fatsecret_foods.name_zh),
      calories = COALESCE(excluded.calories, fatsecret_foods.calories),
      protein = COALESCE(excluded.protein, fatsecret_foods.protein),
      carbs = COALESCE(excluded.carbs, fatsecret_foods.carbs),
      fat = COALESCE(excluded.fat, fatsecret_foods.fat),
      serving = COALESCE(excluded.serving, fatsecret_foods.serving)
  `);

  let total = 0;
  let withNutrition = 0;
  const now = new Date().toISOString();

  for (const q of QUERIES) {
    try {
      const foodData = await apiCall("foods.search", { search_expression: q.en, max_results: "5" });
      const foods = toArr(foodData?.foods?.food);

      for (const f of foods.slice(0, 2)) {
        // Get nutrition details
        let cal: number | null = null, pro: number | null = null, carb: number | null = null, fatt: number | null = null;
        let servingText = "";

        try {
          const detail = await apiCall("food.get.v4", { food_id: f.food_id });
          const servings = detail?.food?.servings?.serving;
          if (servings) {
            const s = Array.isArray(servings) ? servings[0] : servings;
            cal = parseFloat(s.calories) || null;
            pro = parseFloat(s.protein) || null;
            carb = parseFloat(s.carbohydrate) || null;
            fatt = parseFloat(s.fat) || null;
            servingText = s.serving_description || "";
            if (cal) withNutrition++;
          }
        } catch {}

        upsert.run(f.food_id, f.food_name, q.zh, f.food_description || null, cal, pro, carb, fatt, servingText || null, q.en, now);
        total++;
        await new Promise((r) => setTimeout(r, 200));
      }

      process.stdout.write(`\r${QUERIES.indexOf(q) + 1}/${QUERIES.length} "${q.en}" (${q.zh}): total=${total} with_nutrition=${withNutrition}  `);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e: any) {
      console.warn(`\n"${q.en}": ${e.message}`);
    }
  }

  db.close();
  console.log(`\nDone! ${total} foods cached, ${withNutrition} with nutrition data.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
