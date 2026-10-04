import { assessFoodSafety, type FoodSafetyProfile } from "./foodSafety.js";

export interface CookingAdvice {
  text: string;
  /** Undefined means legacy prose whose ingredients have not been verified. */
  ingredients?: readonly string[];
}

/** Apply the same food gate to every additional recommendation. */
export function safeCookingAdvice(advice: CookingAdvice, profile?: FoodSafetyProfile): string | undefined {
  const restricted = Boolean(profile?.allergies?.length || profile?.avoidFoods?.length);
  if (advice.ingredients === undefined && restricted) return undefined;
  return assessFoodSafety(advice.ingredients ?? [], profile).status === "clear" ? advice.text : undefined;
}
