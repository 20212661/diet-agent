export { baseIdentityPrompt } from "./baseIdentityPrompt.js";
export { toolUsagePrompt } from "./toolUsagePrompt.js";
export { cookingPrompt } from "./cookingPrompt.js";
export { dietPrompt } from "./dietPrompt.js";
export { safetyPrompt } from "./safetyPrompt.js";
export { skillUsagePrompt } from "./skillUsagePrompt.js";

import { baseIdentityPrompt } from "./baseIdentityPrompt.js";
import { toolUsagePrompt } from "./toolUsagePrompt.js";
import { cookingPrompt } from "./cookingPrompt.js";
import { dietPrompt } from "./dietPrompt.js";
import { safetyPrompt } from "./safetyPrompt.js";
import { skillUsagePrompt } from "./skillUsagePrompt.js";

export const dietAgentCorePrompt = [
  baseIdentityPrompt,
  toolUsagePrompt,
  cookingPrompt,
  dietPrompt,
  skillUsagePrompt,
  safetyPrompt,
].join("\n\n");
