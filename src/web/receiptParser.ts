import type { ImageContent } from "@earendil-works/pi-ai";
import type { IngredientItem } from "../types/diet.js";
import { resolveModelCandidates } from "../agent/modelAdapter.js";
import { getConfiguredModelRuntime } from "../agent/createDietAgent.js";
const MAX_RECEIPT_IMAGE_BYTES = 4_500_000;

export function receiptImage(payload: Record<string, unknown>): ImageContent {
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
  if (typeof payload.mimeType !== "string" || !allowedMimeTypes.includes(payload.mimeType)) {
    throw new Error("请上传 JPG、PNG 或 WebP 格式的图片。");
  }
  if (typeof payload.data !== "string" || payload.data.length > Math.ceil(MAX_RECEIPT_IMAGE_BYTES * 4 / 3) + 8) {
    throw new Error("图片不能超过 4.5 MB。");
  }
  const buffer = Buffer.from(payload.data, "base64");
  if (!buffer.length || buffer.length > MAX_RECEIPT_IMAGE_BYTES || buffer.toString("base64") !== payload.data.replace(/\s/g, "")) {
    throw new Error("图片数据无效或超过 4.5 MB。");
  }
  return { type: "image", data: buffer.toString("base64"), mimeType: payload.mimeType };
}

export async function parseReceiptImage(image: ImageContent): Promise<IngredientItem[]> {
  const candidate = resolveModelCandidates().find((item) => item.model?.input.includes("image"));
  if (!candidate?.model) throw new Error("当前配置的模型不支持图片识别。请配置支持视觉输入的模型，或粘贴/上传 TXT、CSV 清单。");

  const runtime = await getConfiguredModelRuntime();
  const result = await runtime.completeSimple(candidate.model, {
    messages: [{
      role: "user",
      timestamp: Date.now(),
      content: [
        {
          type: "text",
          text: [
            "识别这张超市购物小票或网购商品清单，只提取已购买、适合放入家庭食材库存的食品/食材。",
            "不要提取金额、优惠、支付信息、商家、联系方式、地址、日用品或纯包装服务。",
            "将商品名简化成食材名称，保留能识别的数量；无法判断数量时留空。",
            '只返回 JSON，不要 Markdown：{"items":[{"name":"番茄","amount":"500克","category":"vegetable","storage":"fridge"}]}。',
            "category 只可用 protein/vegetable/staple/seasoning/dairy/fruit/other；storage 只可用 fridge/freezer/pantry/room_temp。",
            "识别不出有效食材时返回 {\"items\":[]}。",
          ].join("\n"),
        },
        image,
      ],
    }],
  });
  if (result.stopReason === "error") throw new Error("图片识别模型暂时不可用，请稍后重试或粘贴清单文本。");
  const output = result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("模型没有返回可用的食材清单，请尝试更清晰的图片。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  } catch {
    throw new Error("清单识别结果格式无效，请尝试更清晰的图片。");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new Error("图片中没有识别到可入库的食材。");
  }
  const rawItems = (parsed as { items: unknown[] }).items.slice(0, 100);
  const normalized = rawItems.flatMap((raw): IngredientItem[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim()) return [];
    const allowedCategories = ["protein", "vegetable", "staple", "seasoning", "dairy", "fruit", "other"];
    const allowedStorage = ["fridge", "freezer", "pantry", "room_temp"];
    return [{
      name: item.name.trim().slice(0, 100),
      ...(typeof item.amount === "string" && item.amount.trim() ? { amount: item.amount.trim().slice(0, 100) } : {}),
      category: typeof item.category === "string" && allowedCategories.includes(item.category)
        ? item.category as IngredientItem["category"] : "other",
      storage: typeof item.storage === "string" && allowedStorage.includes(item.storage)
        ? item.storage as IngredientItem["storage"] : "fridge",
    }];
  });
  if (!normalized.length) throw new Error("图片中没有识别到可入库的食材。");
  return normalized;
}
