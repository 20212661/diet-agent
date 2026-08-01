/**
 * 档案数据 → markdown 文本 的纯函数格式化器。
 *
 * 纯函数（对象进 → markdown 字符串出），无 TUI / DB 依赖，极易单测。
 * 输出纯 markdown，不着色 —— 着色交给 chatMarkdownTheme（在 profilePanel 里渲染）。
 * 所有空态给「下一步行动引导」示例输入，与欢迎语风格一致。
 */
import type {
  UserProfile,
  KitchenProfile,
  IngredientInventory,
  IngredientItem,
  TodaySummary,
  WeeklyPlan,
  WeeklyDayPlan,
  RecipeRecord,
} from "../types/diet.js";

// ─── 标签映射 ──────────────────────────────────
const GOAL_LABELS: Record<string, string> = {
  fat_loss: "减脂",
  muscle_gain: "增肌",
  maintain: "维持",
  healthier_eating: "吃得更健康",
  custom: "自定义",
};
const ACTIVITY_LABELS: Record<string, string> = {
  low: "久坐少动",
  medium: "中等活动",
  high: "活跃",
};
const CATEGORY_LABELS: Record<string, string> = {
  protein: "蛋白质",
  vegetable: "蔬菜",
  staple: "主食",
  seasoning: "调料",
  dairy: "乳制品",
  fruit: "水果",
  other: "其他",
};
const CATEGORY_ORDER = ["protein", "vegetable", "staple", "fruit", "dairy", "seasoning", "other"];
const STORAGE_LABELS: Record<string, string> = {
  fridge: "冰箱",
  freezer: "冷冻",
  pantry: "橱柜",
  room_temp: "常温",
};
const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// ─── 空态文案 ──────────────────────────────────
export const EMPTY_HINTS = {
  profile:
    "还没录入个人画像。\n\n跟助手说一句你的目标（比如「我想减脂，身高 175 体重 80」），它会自动记录，下次打开这里就能看到。",
  inventory:
    "厨房还是空的。\n\n跟助手说「我冰箱里有鸡蛋、西红柿、鸡腿」，它会帮你建起食材库存。",
  weekly:
    "本周还没有菜单计划。\n\n试试对助手说「帮我排个本周晚餐菜单」，它会根据你的口味和库存安排。",
};

function dateOnly(s?: string): string | undefined {
  return s ? s.slice(0, 10) : undefined;
}

// ─── UserProfile ──────────────────────────────────
export function formatUserProfile(p: UserProfile | undefined): string {
  if (!p) return EMPTY_HINTS.profile;
  const lines: string[] = ["# 用户画像", ""];
  const row = (k: string, v?: string | number) => {
    if (v != null && v !== "") lines.push(`- **${k}**：${v}`);
  };

  row("目标", p.goal ? (GOAL_LABELS[p.goal] ?? p.goal) : undefined);
  if (p.customGoal) row("自定义目标", p.customGoal);
  if (p.heightCm || p.weightKg) {
    const hw = [p.heightCm ? `${p.heightCm}cm` : null, p.weightKg ? `${p.weightKg}kg` : null]
      .filter(Boolean)
      .join(" / ");
    row("身高 / 体重", hw || undefined);
  }
  row("年龄", p.age);
  row("性别", p.gender);
  row("活动水平", p.activityLevel ? (ACTIVITY_LABELS[p.activityLevel] ?? p.activityLevel) : undefined);
  if (p.avoidFoods?.length) lines.push(`- **忌口**：${p.avoidFoods.join("、")}`);
  if (p.allergies?.length) lines.push(`- **过敏**：${p.allergies.join("、")}`);
  if (p.preferences?.length) lines.push(`- **口味偏好**：${p.preferences.join("、")}`);
  if (p.medicalNotes?.length) lines.push(`- **健康备注**：${p.medicalNotes.join("；")}`);
  const upd = dateOnly(p.updatedAt);
  if (upd) lines.push("", `_最后更新：${upd}_`);
  return lines.join("\n");
}

// ─── KitchenProfile ──────────────────────────────────
export function formatKitchenProfile(k: KitchenProfile): string {
  const lines: string[] = ["# 厨房条件", ""];
  lines.push(`- **炉灶**：${k.burners} 个`);
  lines.push(`- **烤箱**：${k.hasOven ? "有" : "无"}`);
  if (k.cookware?.length) lines.push(`- **厨具**：${k.cookware.join("、")}`);
  lines.push(
    `- **时间预算**：主动操作 ≤ ${k.maxActiveMinutes} 分钟 / 总耗时 ≤ ${k.maxTotalMinutes} 分钟`
  );
  if (k.tastePreferences?.length) lines.push(`- **口味偏好**：${k.tastePreferences.join("、")}`);
  if (k.cookingPreferences?.length) lines.push(`- **烹饪偏好**：${k.cookingPreferences.join("、")}`);
  const upd = dateOnly(k.updatedAt);
  if (upd) lines.push("", `_最后更新：${upd}_`);
  return lines.join("\n");
}

// ─── IngredientInventory ──────────────────────────────────
function formatItem(it: IngredientItem): string {
  const parts: string[] = [it.name];
  if (it.amount) parts.push(`${it.amount}${it.unit ?? ""}`);
  if (it.storage) parts.push(STORAGE_LABELS[it.storage] ?? it.storage);
  if (it.expiresSoon) parts.push("⚠️ 快过期");
  let s = parts.join(" · ");
  if (it.expiresAt && it.expiresSoon) s += `（${it.expiresAt}）`;
  return `- ${s}`;
}

export function formatIngredientInventory(inv: IngredientInventory): string {
  const avail = inv.availableIngredients ?? [];
  const shop = inv.shoppingList ?? [];
  if (!avail.length && !shop.length) return EMPTY_HINTS.inventory;

  const lines: string[] = ["# 食材库存", ""];

  if (avail.length) {
    lines.push(`## 可用食材（${avail.length}）`);
    const groups = new Map<string, IngredientItem[]>();
    for (const it of avail) {
      const key = it.category ?? "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    // 按固定顺序输出已知 category
    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (!items?.length) continue;
      lines.push(`**${CATEGORY_LABELS[cat] ?? cat}**`);
      for (const it of items) lines.push(formatItem(it));
      groups.delete(cat);
    }
    // 兜底：未知 category
    for (const [cat, items] of groups) {
      lines.push(`**${CATEGORY_LABELS[cat] ?? cat}**`);
      for (const it of items) lines.push(formatItem(it));
    }
  }

  if (shop.length) {
    lines.push("", `## 购物清单（${shop.length}）`);
    for (const it of shop) {
      const parts = [it.name];
      if (it.amount) parts.push(`${it.amount}${it.unit ?? ""}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }

  const upd = dateOnly(inv.updatedAt);
  if (upd) lines.push("", `_最后更新：${upd}_`);
  return lines.join("\n");
}

// ─── TodaySummary ──────────────────────────────────
export function formatTodaySummary(t: TodaySummary): string {
  const lines: string[] = [`# 今日记录（${t.date}）`, ""];
  if (t.summaryText && t.summaryText.trim()) {
    lines.push(t.summaryText.trim());
  } else {
    lines.push("今天还没有饮食记录。");
  }
  lines.push("", "_跟助手说「我刚吃了…」即可记录_");
  return lines.join("\n");
}

// ─── WeeklyPlan ──────────────────────────────────
function formatDay(d: WeeklyDayPlan): string[] {
  const wd = WEEKDAY_LABELS[d.dayOfWeek] ?? `第${d.dayOfWeek}天`;
  const check = d.completed ? " ✅" : "";
  const main = d.mainRecipe;
  const kcal = main.estimatedCalories ? ` · ${main.estimatedCalories}kcal` : "";
  const lines: string[] = [
    `### ${wd}（${d.date}）${check}`,
    `- 主菜：**${main.name}**（主动 ${main.activeMinutes}′ / 共 ${main.totalMinutes}′${kcal}）`,
  ];
  if (d.sideRecipe) {
    lines.push(
      `- 配菜：${d.sideRecipe.name}（主动 ${d.sideRecipe.activeMinutes}′ / 共 ${d.sideRecipe.totalMinutes}′）`
    );
  }
  if (d.staplesSuggestion) lines.push(`- 主食：${d.staplesSuggestion}`);
  if (d.missingIngredients?.length) lines.push(`- ⚠️ 缺食材：${d.missingIngredients.join("、")}`);
  return lines;
}

export function formatWeeklyPlan(w: WeeklyPlan | undefined): string {
  if (!w || !w.days?.length) return EMPTY_HINTS.weekly;
  const lines: string[] = [`# 本周菜单（${w.weekStartDate} 起）`, ""];
  for (const d of w.days) {
    lines.push(...formatDay(d), "");
  }
  return lines.join("\n");
}

// ─── RecipeBook ──────────────────────────────────
function difficultyStars(n: number): string {
  return "★".repeat(Math.max(0, Math.min(5, n)));
}

export function formatRecipeBook(recipes: RecipeRecord[]): string {
  if (!recipes.length) return "菜谱库为空。";
  const lines: string[] = [`# 菜谱库（${recipes.length} 道）`, ""];
  for (const r of recipes) {
    const parts: string[] = [`**${r.name}**`];
    if (r.primaryProtein) parts.push(`蛋白:${r.primaryProtein}`);
    parts.push(`${r.activeMinutes}/${r.totalMinutes}分钟`);
    if (r.estimatedCalories) parts.push(`${r.estimatedCalories}kcal`);
    parts.push(`难度${difficultyStars(r.difficulty)}`);
    lines.push(`- ${parts.join(" · ")}`);
  }
  return lines.join("\n");
}
