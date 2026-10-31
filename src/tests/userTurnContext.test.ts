import { describe, expect, it } from "vitest";
import { detectUnsavedMealClaim, hasAmbiguousMealDate } from "../utils/userTurnContext.js";

describe("detectUnsavedMealClaim（记餐声称未落库兜底）", () => {
  it("完成态声称词命中：已记录/记下了/记成/帮你记了", () => {
    expect(detectUnsavedMealClaim("好，无糖酸奶我记成 1 杯。现在还差燕麦粥的份量。")).toBe(true);
    expect(detectUnsavedMealClaim("✅ 已记录：今天早餐是豆浆 1 杯、油条 1 根")).toBe(true);
    expect(detectUnsavedMealClaim("一碗米饭我记下了。")).toBe(true);
    expect(detectUnsavedMealClaim("已帮你记录今天的加餐。")).toBe(true);
  });

  it("否定句与未来态不算声称", () => {
    // log07 轮3 的诚实回复：说了"没有记录"，不能误报
    expect(detectUnsavedMealClaim("今天系统里还没有任何饮食记录。")).toBe(false);
    expect(detectUnsavedMealClaim("晚餐的土豆炖牛腩和米饭还没写入。")).toBe(false);
    expect(detectUnsavedMealClaim("你不要记这条。")).toBe(false);
  });

  it("不含声称词的回复不算", () => {
    expect(detectUnsavedMealClaim("请确认一下这杯拿铁是今天早上喝的吗？")).toBe(false);
    expect(detectUnsavedMealClaim("今晚推荐番茄炒蛋和米饭。")).toBe(false);
  });

  it("bench 实测误报原例不再命中：登记成现有食材/记进库存/反馈已记录（写入白名单兜住）", () => {
    // stock02 原例："帮你登记成现有食材"撞裸词"记成"——记成后必须跟数量或餐次
    expect(detectUnsavedMealClaim("想直接记进库存：告诉我牛奶和酸奶各多少，我帮你登记成现有食材。")).toBe(false);
    expect(detectUnsavedMealClaim("已记录：番茄鸡蛋面 4/5 分，下次还推荐做。")).toBe(true); // 词表命中，但 log_cooking_feedback 成功写入时白名单不触发提示
    expect(detectUnsavedMealClaim("好，无糖酸奶我记成 1 杯，燕麦粥的份量回头补。")).toBe(true);
  });
});

describe("hasAmbiguousMealDate（时段词默认今天）", () => {
  it("早上/晚上/夜宵等时段词不再视为日期歧义", () => {
    expect(hasAmbiguousMealDate("早上喝了一杯拿铁，帮我记一下")).toBe(false);
    expect(hasAmbiguousMealDate("早餐还吃了两片全麦面包")).toBe(false);
    expect(hasAmbiguousMealDate("晚上吃了一碗面")).toBe(false);
  });

  it("相对日期词仍然追问", () => {
    expect(hasAmbiguousMealDate("前天吃了一碗米饭")).toBe(true);
    expect(hasAmbiguousMealDate("昨天夜宵吃了一包泡面")).toBe(true);
  });
});
