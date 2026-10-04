/**
 * Backward-compatible storage facade.
 *
 * Database lifecycle, migrations and domain repositories live in separate modules;
 * existing callers can continue importing the original sqliteStore entry point.
 */
export { closeDatabase, getDatabase, getDatabasePath } from "./database.js";
export { getUserProfile, upsertUserProfile } from "./repositories/userProfileRepository.js";
export { getKitchenProfile, upsertKitchenProfile } from "./repositories/kitchenProfileRepository.js";
export {
  addIngredientInventoryItem,
  getIngredientInventory,
  replaceIngredientInventoryIfCurrent,
  updateIngredientInventoryItem,
  updateIngredientStatus,
  upsertIngredientInventory,
} from "./repositories/inventoryRepository.js";
export {
  addMealLog,
  getDeletedMealLogsByDate,
  getMealLogDates,
  updateMealLog,
  undoMealLog,
  restoreMealLog,
  getAllMealLogs,
  getMealLogsByDate,
  getTodaySummary,
} from "./repositories/mealRepository.js";
export { addCookingFeedback, getCookingFeedback } from "./repositories/feedbackRepository.js";
export { getRecipeBook, getRecipeById, upsertRecipe } from "./repositories/recipeRepository.js";
export {
  clearWeeklyPlan,
  getWeeklyPlan,
  replaceWeeklyPlanDayMainRecipe,
  setWeeklyPlanDayCompleted,
  upsertWeeklyPlan,
} from "./repositories/weeklyPlanRepository.js";
export { getMealPlan, getMealPlanByStartDate, upsertMealPlan } from "./repositories/mealPlanRepository.js";
export { clearUserData } from "./repositories/userDataRepository.js";
