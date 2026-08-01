/**
 * 「我的档案」查看面板（Ctrl+P 唤出）。
 *
 * 命令式 pi-tui 框架下的模态查看面板：
 *  - openProfilePanel：控制器，弹菜单 overlay，选中后叠详情 overlay
 *  - ProfileMenuView / ProfileDetailView：自实现 Component（Box 无 handleInput，必须自实现转发）
 *  - ScrollableText：长内容（菜谱库 69 道 / 周菜单）翻页包装器
 *
 * 数据走 sqliteStore 同步 getter，不经 AI、不经网络。
 * 焦点靠 overlay 栈自动还原（详情 hide → 焦点回菜单）。
 */
import {
  SelectList,
  Text,
  Markdown,
  matchesKey,
  type Component,
  type OverlayHandle,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  getUserProfile,
  getKitchenProfile,
  getIngredientInventory,
  getTodaySummary,
  getWeeklyPlan,
  getRecipeBook,
} from "../store/index.js";
import { cyan, bold, gray, chatMarkdownTheme } from "./theme.js";
import {
  formatUserProfile,
  formatKitchenProfile,
  formatIngredientInventory,
  formatTodaySummary,
  formatWeeklyPlan,
  formatRecipeBook,
} from "./profileFormatters.js";

// ─── 菜单 ──────────────────────────────────
const MENU_ITEMS: SelectItem[] = [
  { value: "profile", label: "用户画像", description: "目标 / 身高体重 / 忌口 / 过敏" },
  { value: "kitchen", label: "厨房条件", description: "炉灶 / 厨具 / 时间预算" },
  { value: "inventory", label: "食材库存", description: "可用食材 / 购物清单" },
  { value: "today", label: "今日记录", description: "今日三餐与热量" },
  { value: "weekly", label: "本周菜单", description: "本周 7 天计划" },
  { value: "recipes", label: "菜谱库", description: "全部菜谱" },
];

const selectTheme: SelectListTheme = {
  selectedPrefix: () => cyan("▸ "),
  selectedText: (t) => bold(t),
  description: (t) => gray(t),
  scrollInfo: (t) => gray(t),
  noMatch: (t) => t,
};

// ─── key → {title, text}：集中所有 store 读取 ──────────────────────────────────
function loadDetailText(userId: string, key: string): { title: string; text: string } {
  try {
    switch (key) {
      case "profile":
        return { title: "用户画像", text: formatUserProfile(getUserProfile(userId)) };
      case "kitchen":
        return { title: "厨房条件", text: formatKitchenProfile(getKitchenProfile(userId)) };
      case "inventory":
        return { title: "食材库存", text: formatIngredientInventory(getIngredientInventory(userId)) };
      case "today":
        return { title: "今日记录", text: formatTodaySummary(getTodaySummary(userId)) };
      case "weekly":
        return { title: "本周菜单", text: formatWeeklyPlan(getWeeklyPlan(userId)) };
      case "recipes":
        return { title: "菜谱库", text: formatRecipeBook(getRecipeBook()) };
      default:
        return { title: "档案", text: "未知项。" };
    }
  } catch (e: any) {
    return { title: "出错", text: `读取数据失败：${e?.message ?? String(e)}` };
  }
}

// ─── ScrollableText：长内容翻页 ──────────────────────────────────
class ScrollableText implements Component {
  private offset = 0;
  private cached: string[] = [];
  private lastWidth = -1;
  constructor(private child: Component, private maxRows: number) {}

  render(width: number): string[] {
    if (width !== this.lastWidth) {
      this.lastWidth = width;
      this.child.invalidate?.();
    }
    this.cached = this.child.render(width);
    const max = Math.max(1, this.maxRows);
    const last = Math.max(0, this.cached.length - max);
    if (this.offset > last) this.offset = last;
    if (this.offset < 0) this.offset = 0;
    return this.cached.slice(this.offset, this.offset + max);
  }

  handleInput(data: string): void {
    const max = Math.max(1, this.maxRows);
    const last = Math.max(0, this.cached.length - max);
    if (matchesKey(data, "down")) this.offset = Math.min(last, this.offset + 1);
    else if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(data, "pageDown")) this.offset = Math.min(last, this.offset + max);
    else if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - max);
    else if (matchesKey(data, "home")) this.offset = 0;
    else if (matchesKey(data, "end")) this.offset = last;
  }

  invalidate(): void {
    this.cached = [];
    this.lastWidth = -1;
    this.child.invalidate?.();
  }

  /** 形如 "3-12/69"，仅供详情底部显示；内容不超 maxRows 时返回空串 */
  getScrollInfo(): string {
    const max = Math.max(1, this.maxRows);
    if (this.cached.length <= max) return "";
    const end = Math.min(this.cached.length, this.offset + max);
    return `${this.offset + 1}-${end}/${this.cached.length}`;
  }
}

// ─── ProfileMenuView：标题 + SelectList（转发按键）──────────────────────────────────
class ProfileMenuView implements Component {
  private header: Text;
  constructor(private list: SelectList) {
    this.header = new Text(
      bold(cyan(" 📄 我的档案 ")) + gray("  ↑↓ 选择 · Enter 查看 · Esc 关闭"),
      0,
      0
    );
  }
  render(width: number): string[] {
    return [...this.header.render(width), ...this.list.render(width)];
  }
  handleInput(data: string): void {
    this.list.handleInput(data);
  }
  invalidate(): void {
    this.header.invalidate();
    this.list.invalidate();
  }
}

// ─── ProfileDetailView：标题 + 滚动正文 + Esc 返回 ──────────────────────────────────
class ProfileDetailView implements Component {
  private header: Text;
  constructor(
    title: string,
    private body: Component,
    private scrollInfo: () => string,
    private onBack: () => void
  ) {
    this.header = new Text(
      bold(cyan(` 📄 ${title} `)) + gray("  ↑↓ 滚动 · Esc 返回"),
      0,
      0
    );
  }
  render(width: number): string[] {
    const head = this.header.render(width);
    const body = this.body.render(width);
    const info = this.scrollInfo();
    const foot = info ? [gray(`   (${info})`)] : [];
    return [...head, ...body, ...foot];
  }
  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.onBack();
      return;
    }
    this.body.handleInput?.(data);
  }
  invalidate(): void {
    this.header.invalidate();
    this.body.invalidate?.();
  }
}

// ─── 控制器：打开面板 ──────────────────────────────────
export function openProfilePanel(tui: TUI, userId: string): void {
  const list = new SelectList(MENU_ITEMS, 8, selectTheme);
  const menuView = new ProfileMenuView(list);
  let menuHandle: OverlayHandle | null = null;

  list.onSelect = (item) => {
    if (menuHandle) menuHandle.setHidden(true);

    const { title, text } = loadDetailText(userId, item.value);
    const bodyMd = new Markdown(text, 1, 0, chatMarkdownTheme);
    const rows = Math.max(8, (process.stdout.rows ?? 24) - 6);
    const body = new ScrollableText(bodyMd, rows);

    let detailHandle: OverlayHandle | null = null;
    const onBack = () => {
      if (detailHandle) detailHandle.hide();
      if (menuHandle) {
        menuHandle.setHidden(false);
        menuHandle.focus();
      }
      tui.requestRender();
    };

    const detailView = new ProfileDetailView(title, body, () => body.getScrollInfo(), onBack);
    detailHandle = tui.showOverlay(detailView, {
      width: "70%",
      maxHeight: Math.max(10, (process.stdout.rows ?? 24) - 4),
      anchor: "center",
    });
  };

  list.onCancel = () => {
    if (menuHandle) {
      menuHandle.hide();
      menuHandle = null;
    }
  };

  menuHandle = tui.showOverlay(menuView, { width: 54, maxHeight: 12, anchor: "center" });
}
