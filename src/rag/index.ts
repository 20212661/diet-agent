export { buildRecipeText, hashRecipeText } from "./buildRecipeText.js";
export {
  resolveEmbeddingConfig,
  embed,
  normalize,
  type EmbeddingConfig,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "./embeddingAdapter.js";
export {
  createVectorStore,
  InMemoryVecStore,
  SqliteVecStore,
  type VectorStore,
  type KnnHit,
} from "./vectorStore.js";
export { RecipeRetriever, getRetriever, _resetRetrieverForTests, type RecallResult } from "./recipeRetriever.js";
