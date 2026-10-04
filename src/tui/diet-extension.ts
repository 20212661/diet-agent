import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { checkModelConfiguration, formatModelCheckResult } from "../agent/configDoctor.js";
import * as store from "../store/index.js";
import {
  deleteUserData,
  exportUserData,
  getBackupRetentionPolicy,
  getUserDataOverview,
} from "../privacy/userData.js";
import { flushPendingRequestLogs } from "../utils/requestLogger.js";
import { setActiveUserMessage } from "../utils/userTurnContext.js";

/** Pi 原生交互应用中的饮食命令扩展。 */
export function createDietExtension(userId: string): InlineExtension {
  return (pi: ExtensionAPI) => {
    let clearActiveMessage: (() => void) | undefined;
    let deleteAfterShutdown = false;

    pi.on("before_agent_start", (event) => {
      clearActiveMessage?.();
      clearActiveMessage = setActiveUserMessage(userId, event.prompt);
    });
    pi.on("agent_settled", () => {
      clearActiveMessage?.();
      clearActiveMessage = undefined;
    });
    pi.on("session_shutdown", async () => {
      clearActiveMessage?.();
      clearActiveMessage = undefined;
      if (!deleteAfterShutdown) return;
      await flushPendingRequestLogs();
      const result = deleteUserData(userId, () => {});
      process.stdout.write(
        `\n已删除当前用户数据：数据库记录 ${result.databaseRows} 条，会话文件 ${result.sessionFiles} 个，导出文件 ${result.exportFiles} 个，诊断日志 ${result.requestLogFiles} 个，清理迁移备份 ${result.backupsScrubbed} 份。\n` +
        (result.backupErrors ? `⚠️ ${result.backupErrors} 份备份未能清理，删除尚未完整完成，请检查权限或磁盘状态。\n` : ""),
      );
    });

    pi.registerCommand("doctor", {
      description: "检查模型供应商、认证和网络状态",
      handler: async (_args, ctx) => {
        const result = await checkModelConfiguration();
        ctx.ui.notify(formatModelCheckResult(result), result.severity === "error" ? "error" : result.severity === "warning" ? "warning" : "info");
      },
    });

    pi.registerCommand("profile", {
      description: "查看当前用户饮食画像和厨房设备",
      handler: async (_args, ctx) => {
        const profile = store.getUserProfile(userId);
        const kitchen = store.getKitchenProfile(userId);
        ctx.ui.notify([
          `用户：${userId}`,
          `目标：${profile?.goal ?? "未设置"}`,
          `忌口：${profile?.avoidFoods?.join("、") || "无"}`,
          `过敏：${profile?.allergies?.join("、") || "无"}`,
          `厨房：${kitchen.burners} 个灶眼，烤箱${kitchen.hasOven ? "有" : "无"}，微波炉${kitchen.hasMicrowave ? "有" : "无"}，电饭煲${kitchen.hasRiceCooker ? "有" : "无"}`,
        ].join("\n"));
      },
    });

    pi.registerCommand("data", {
      description: "查看当前用户本机数据概览",
      handler: async (_args, ctx) => {
        const overview = getUserDataOverview(userId);
        const dbCount = Object.entries(overview.database)
          .map(([key, value]) => `  - ${key}: ${value}`)
          .join("\n");
        ctx.ui.notify([
          "此用户本机数据概览：",
          `数据库记录：\n${dbCount}`,
          `会话文件：${overview.sessionFiles}`,
          `已生成导出文件：${overview.exportFiles}`,
          `请求诊断日志：${overview.requestLogFiles}`,
          `全局迁移备份：${overview.migrationBackups}`,
          getBackupRetentionPolicy(),
          "使用 /diet-export 导出，使用 /delete-data 预览并删除。",
        ].join("\n"));
      },
    });

    pi.registerCommand("diet-export", {
      description: "导出当前用户饮食数据和 Pi 会话文件",
      handler: async (_args, ctx) => {
        try {
          await flushPendingRequestLogs();
          ctx.ui.notify(`用户数据已导出为 JSON：${exportUserData(userId, [])}`);
        } catch (error) {
          ctx.ui.notify(`导出失败：${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    });

    pi.registerCommand("delete-data", {
      description: "预览并确认删除当前用户的本机数据",
      getArgumentCompletions: (prefix) => "CONFIRM".startsWith(prefix.toUpperCase())
        ? [{ value: "CONFIRM", label: "CONFIRM", description: "永久删除当前用户数据" }]
        : null,
      handler: async (args, ctx) => {
        const overview = getUserDataOverview(userId);
        const dbCount = Object.entries(overview.database)
          .map(([key, value]) => `  - ${key}: ${value}`)
          .join("\n");
        const preview = [
          `即将删除用户 ${userId} 的本机数据：`,
          `数据库记录：\n${dbCount}`,
          `会话文件：${overview.sessionFiles}`,
          `导出文件：${overview.exportFiles}`,
          `请求诊断日志：${overview.requestLogFiles}`,
          `全局迁移备份：${overview.migrationBackups}（会清除其中该用户的记录）`,
          getBackupRetentionPolicy(),
        ].join("\n");

        if (args.trim().toUpperCase() !== "CONFIRM") {
          ctx.ui.notify(`${preview}\n\n如确认删除，请输入：/delete-data CONFIRM`, "warning");
          return;
        }
        if (!await ctx.ui.confirm("删除当前用户数据", `${preview}\n\n此操作不可撤销。`)) return;

        deleteAfterShutdown = true;
        ctx.ui.notify("正在安全关闭 Pi 并删除数据…");
        ctx.shutdown();
      },
    });
  };
}
