type TimedRecipe = { activeMinutes: number; totalMinutes: number };
type TimeLimits = { maxActiveMinutes: number; maxTotalMinutes: number };

/** Without step-level scheduling, count two recipes as sequential work. */
export function mealFitsTimeLimits(main: TimedRecipe, side: TimedRecipe | undefined, limits: TimeLimits): boolean {
  return main.activeMinutes + (side?.activeMinutes ?? 0) <= limits.maxActiveMinutes
    && main.totalMinutes + (side?.totalMinutes ?? 0) <= limits.maxTotalMinutes;
}
