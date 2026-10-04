import { esc, list, emptyState, panel, detailRows, pageIntro, readableDate, mealLabel, formSelect } from "./viewFormatters.js";

export function mealEditorForm(meal = null, selectedDiaryDate = null, dataDate = null) {
  const foodText = meal ? list(meal.foods).map((food) => `${food.name}${food.amount ? ` | ${food.amount}` : ""}`).join("\n") : "";
  const options = [["breakfast", "早餐"], ["lunch", "午餐"], ["dinner", "晚餐"], ["snack", "加餐"], ["unknown", "其他"]];
  return `<form class="editor-form meal-editor-form" data-meal-form ${meal ? `data-meal-id="${esc(meal.id)}"` : "data-new-meal"}><div class="form-grid"><label class="field"><span>日期</span><input type="date" name="date" value="${esc(meal?.date ?? selectedDiaryDate ?? dataDate ?? "")}" required></label>${formSelect("餐次", "mealType", meal?.mealType ?? "dinner", options)}<label class="field field-wide"><span>食物与份量（每行一项，名称 | 份量）</span><textarea name="foods" rows="4" required placeholder="例如：\n米饭 | 1碗\n番茄炒蛋 | 1份">${esc(foodText)}</textarea></label><label class="field field-wide"><span>备注</span><textarea name="note" rows="2">${esc(meal?.note ?? "")}</textarea></label></div><div class="form-actions"><span>${meal ? "保存后当天汇总会立即更新。" : "记录会保存到所选日期。"}</span><button class="primary-button" type="submit">${meal ? "保存修改" : "新增记录"}</button><button class="secondary-button" type="button" data-cancel-meal-edit>取消</button></div></form>`;
}

export function mealRows(meals, editingMealId = null, selectedDiaryDate = null, dataDate = null) {
  if (!meals?.length) return emptyState("◷", "今天还没有饮食记录", "记录一餐后，这里会显示餐次和食物详情。", `<button class="text-button" data-chat-prompt="帮我记录我刚才吃的食物">去记录 ↗</button>`);
  return `<div class="meal-list">${meals.map((meal) => {
    if (editingMealId === meal.id) return `<div class="meal-edit-card">${mealEditorForm(meal, selectedDiaryDate, dataDate)}</div>`;
    const foods = list(meal.foods).map((food) => `${esc(food.name)}${food.amount ? ` ${esc(food.amount)}` : ""}`).join("、");
    const cals = list(meal.foods).reduce((sum, food) => sum + (Number(food.nutrition?.calories) || 0), 0);
    return `<div class="meal-row"><span class="meal-time">${esc(mealLabel(meal.mealType))}</span><span class="meal-bullet"></span><div class="meal-content"><strong>${foods || "餐食"}</strong><p>${esc(meal.note || "已记录")}</p></div><span class="meal-calories">${cals ? `${Math.round(cals)} kcal` : "—"}</span><span class="meal-actions"><button class="text-button" type="button" data-edit-meal="${esc(meal.id)}">编辑</button><button class="text-button" type="button" data-delete-meal="${esc(meal.id)}">移除</button></span></div>`;
  }).join("")}</div>`;
}

export function deletedMealRows(meals) {
  if (!meals.length) return `<p class="support-copy">没有待恢复的记录。</p>`;
  return `<div class="deleted-meal-list">${meals.map((meal) => `<div class="deleted-meal"><span>${esc(mealLabel(meal.mealType))} · ${esc(list(meal.foods).map((food) => food.name).join("、"))}</span><button class="text-button" type="button" data-restore-meal="${esc(meal.id)}">恢复</button></div>`).join("")}</div>`;
}

export function renderDiaryPage(data, description, selectedDiaryDate = null, diaryState = null, editingMealId = null) {
  const diaryDate = selectedDiaryDate ?? data?.date ?? "";
  const selectedDiary = diaryState?.date === diaryDate ? diaryState : null;
  const meals = list(data?.today?.meals);
  const today = data?.today;
  const diaryMeals = selectedDiary?.meals ?? (diaryDate === data?.date ? meals : []);
  const diarySummary = selectedDiary?.summary ?? (diaryDate === data?.date ? today : null);
  const deletedMeals = selectedDiary?.deletedMeals ?? [];

  const intro = pageIntro("FOOD DIARY", "饮食记录", description, `<button class="primary-button" data-toggle-meal-add>＋ 新增记录</button>`);
  const dateNav = `<div class="diary-date-nav"><label class="field"><span>查看日期</span><input type="date" data-diary-date value="${esc(diaryDate)}"></label><div class="recent-dates"><span>最近有记录的日期</span>${list(selectedDiary?.recentDates).map((date) => `<button class="text-button${date === diaryDate ? " active" : ""}" type="button" data-diary-recent="${esc(date)}">${esc(date)}</button>`).join("") || `<span class="support-copy">暂无其他记录日期</span>`}</div></div>`;
  const body = `<div class="grid section-grid"><div>${panel("餐次记录", mealRows(diaryMeals, editingMealId, diaryDate, data?.date), readableDate(diaryDate))}${panel("新增饮食记录", `<details data-new-meal-details><summary>手动添加一条饮食记录</summary>${mealEditorForm(null, diaryDate, data?.date)}</details>`)}<details class="deleted-meal-history"><summary>已移除记录（可恢复）</summary>${deletedMealRows(deletedMeals)}</details></div><div>${panel("当日营养概况", detailRows([["已记录餐次", `${diaryMeals.length} 餐`], ["可追溯热量", diarySummary?.estimatedTotalCalories !== undefined ? `${Math.round(diarySummary.estimatedTotalCalories)} kcal` : "暂不可汇总"], ["数据来源", "所选日期的记录食物与份量"], ["记录日期", esc(diaryDate)]]))}${panel("数据说明", `<p class="support-copy">只有当所有记录食物都具备可追溯的热量数据时，才会展示合计。热量估算用于日常参考，不代替专业营养评估。移除的记录可在“已移除记录”中恢复。</p>`)}</div></div>`;
  return `${intro}${dateNav}${body}`;
}
