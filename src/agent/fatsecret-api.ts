/**
 * FatSecret Platform API 集成
 * 提供 OAuth 2.0 认证 + 食物搜索 + 菜谱搜索
 * Token 有效期 24 小时，自动刷新
 */

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_URL = "https://platform.fatsecret.com/rest/server.api";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FATSECRET_CLIENT_ID?.trim();
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("FatSecret API is not configured. Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const cred = getCredentials();

  const basic = Buffer.from(`${cred.clientId}:${cred.clientSecret}`).toString("base64");
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: "grant_type=client_credentials&scope=basic",
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`FatSecret token error ${resp.status}: ${text}`);
  }

  const data = await resp.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

async function apiCall(method: string, params: Record<string, string>): Promise<any> {
  const token = await getAccessToken();
  const body = new URLSearchParams({
    method,
    format: "json",
    ...params,
  });

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Bearer ${token}`,
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`FatSecret API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

export interface FatSecretFood {
  foodId: string;
  name: string;
  description?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface FatSecretRecipe {
  recipeId: string;
  name: string;
  description?: string;
  url?: string;
  calories?: number;
}

export async function searchFoods(query: string, maxResults = 5): Promise<FatSecretFood[]> {
  try {
    const data = await apiCall("foods.search", {
      search_expression: query,
      max_results: String(maxResults),
      region: "0",
      language: "0",
    });

    const foods = data?.foods?.food;
    if (!foods) return [];
    const list = Array.isArray(foods) ? foods : [foods];

    return list.map((f: any) => ({
      foodId: String(f.food_id),
      name: f.food_name,
      description: f.food_description,
    }));
  } catch (err) {
    console.warn("[FatSecret] foods.search failed:", (err as Error).message);
    return [];
  }
}

export async function searchRecipes(query: string, maxResults = 5): Promise<FatSecretRecipe[]> {
  try {
    const data = await apiCall("recipes.search.v2", {
      search_expression: query,
      max_results: String(maxResults),
      region: "0",
      language: "0",
    });

    const recipes = data?.recipes?.recipe;
    if (!recipes) return [];
    const list = Array.isArray(recipes) ? recipes : [recipes];

    return list.map((r: any) => ({
      recipeId: String(r.recipe_id),
      name: r.recipe_name,
      description: r.recipe_description,
      url: r.recipe_url,
    }));
  } catch (err) {
    console.warn("[FatSecret] recipes.search failed:", (err as Error).message);
    return [];
  }
}

export async function getFoodNutrition(foodId: string): Promise<{
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingText: string;
} | null> {
  try {
    const data = await apiCall("food.get.v4", {
      food_id: foodId,
      region: "0",
      language: "0",
    });

    const servings = data?.food?.servings?.serving;
    if (!servings) return null;
    const serving = Array.isArray(servings) ? servings[0] : servings;

    return {
      calories: parseFloat(serving.calories) || 0,
      protein: parseFloat(serving.protein) || 0,
      carbs: parseFloat(serving.carbohydrate) || 0,
      fat: parseFloat(serving.fat) || 0,
      servingText: serving.serving_description || "",
    };
  } catch (err) {
    console.warn("[FatSecret] food.get failed:", (err as Error).message);
    return null;
  }
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.FATSECRET_CLIENT_ID?.trim() &&
    process.env.FATSECRET_CLIENT_SECRET?.trim()
  );
}
