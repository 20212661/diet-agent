import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const privacy = await import("../privacy/userData.js");
const { executeWebWriteOnce } = await import("../web/writeOnce.js");
const { claimChatOperation, finishChatOperation } = await import("../web/chatOperationStore.js");

describe("本地用户数据导出与删除", () => {
  it("导出后删除数据库、会话、日志和导出，并在数据库重开后保持删除", () => {
    const userId = `privacy_${randomUUID()}`;
    const hash = createHash("sha256").update(userId, "utf8").digest("hex");
    const root = join(process.cwd(), "data");
    const userHash = hash.slice(0, 32);
    const sessionDir = join(root, "sessions", userHash);
    const logDir = join(process.cwd(), "logs", "api-requests", userHash);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(sessionDir, "session.jsonl"), "session fixture", "utf8");
    writeFileSync(join(logDir, "request.txt"), "request fixture", "utf8");
    let exportPath = "";
    try {
      store.upsertUserProfile(userId, { allergies: ["花生"] });
      store.addMealLog({ userId, mealType: "lunch", foods: [{ name: "米饭", amount: "1碗" }] });
      store.upsertMealPlan(userId, "2026-09-23", [{ date: "2026-09-23", meals: [] }], {
        constraints: { temporaryAvoidFoods: ["鸡蛋"], timeLimitMinutes: 15, energyLevel: "low", preferredStyles: ["清淡"] },
      });
      executeWebWriteOnce(store.getDatabase(), userId, "/api/profile", { operationId: "privacy-write-123" }, () => ({ saved: true }));
      claimChatOperation(store.getDatabase(), userId, "privacy-chat-123", "记录午餐", false);
      finishChatOperation(store.getDatabase(), userId, "privacy-chat-123", {
        type: "done", status: "done", reply: "午餐已记录",
      });
      exportPath = privacy.exportUserData(userId, [{ role: "user", content: "过敏信息", createdAt: new Date().toISOString() }]);
      const exported = JSON.parse(readFileSync(exportPath, "utf8")) as Record<string, any>;
      expect(exported.database.profile.allergies).toEqual(["花生"]);
      expect(exported.database.mealPlans).toHaveLength(1);
      expect(exported.database.webWriteOperations).toHaveLength(1);
      expect(exported.database.chatOperations).toHaveLength(1);
      expect(JSON.parse(exported.database.mealPlans[0].constraints_json).temporaryAvoidFoods).toEqual(["鸡蛋"]);
      expect(exported.sessionFiles).toHaveLength(1);
      expect(exported.requestLogs).toHaveLength(1);

      const removed = privacy.deleteUserData(userId, () => {});
      expect(removed).toMatchObject({ databaseRows: 7, sessionFiles: 1, exportFiles: 1, requestLogFiles: 1, backupErrors: 0 });
      expect(existsSync(exportPath)).toBe(false);
      expect(privacy.getUserDataOverview(userId)).toMatchObject({
        database: { profile: 0, kitchen: 0, inventory: 0, meals: 0, mealOperations: 0, feedback: 0, weeklyPlans: 0, mealPlans: 0 },
        sessionFiles: 0, exportFiles: 0, requestLogFiles: 0,
      });

      store.closeDatabase();
      expect(store.getUserProfile(userId)).toBeUndefined();
    } finally {
      store.closeDatabase();
      if (exportPath) rmSync(exportPath, { force: true });
      rmSync(sessionDir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});
