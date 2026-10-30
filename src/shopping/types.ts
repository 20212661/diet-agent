import type { IngredientItem } from "../types/diet.js";

export type ShoppingProvider = "meituan" | "taobao";
export type ShoppingItemStatus = "pending" | "ordered" | "partially_received" | "received" | "cancelled";
export interface ShoppingItem {
  id: string;
  name: string;
  amount?: string;
  sourceItem?: IngredientItem;
  status: ShoppingItemStatus;
}
export interface ShoppingTask {
  id: string;
  userId: string;
  title: string;
  provider: ShoppingProvider;
  items: ShoppingItem[];
  status: "draft" | "ordered" | "in_progress" | "partially_received" | "completed" | "cancelled";
  version: number;
  createdAt: string;
  updatedAt: string;
  receiptHistory?: Array<{createdAt: string; items: ReceiveItem[]}>;
}
export interface ReceiveItem {
  itemId: string;
  name: string;
  amount?: string;
  storage: NonNullable<IngredientItem["storage"]>;
  complete: boolean;
  mergeTargetId?: string;
  mergedAmount?: string;
}
export const SHOPPING_TABLES = ["shopping_cart_experiments", "shopping_candidates", "shopping_provider_checks", "shopping_receipts", "shopping_events", "shopping_tasks", "shopping_provider_settings"] as const;
