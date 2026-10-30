import { getDatabase } from "../database.js";
import { SHOPPING_TABLES } from "../../shopping/types.js";
import { deleteAgentTracesForUser } from "./traceRepository.js";

export function clearUserData(userId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    for (const table of SHOPPING_TABLES) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    db.prepare("DELETE FROM user_profiles WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM kitchen_profiles WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM ingredient_inventory WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM meal_logs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM meal_operations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM web_write_operations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM chat_operations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM weekly_plan_day_status WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM cooking_feedback WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM weekly_plans WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM meal_plans WHERE user_id = ?").run(userId);
    deleteAgentTracesForUser(db, userId);
  })();
}
