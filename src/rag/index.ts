export { buildRecipeText, hashRecipeText } from "./buildRecipeText.js";
// 注意：localEmbedder 不在此静态导出——它会触发 transformers.js（重）加载。
// 仅通过 embeddingAdapter.embed 的 local 分支动态 import，避免不用本地模型时也加载。
export { bigramize } from "./tokenizer.js";
export { reciprocalRankFusion, type RrfResult } from "./rrf.js";
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
export { FtsStore } from "./ftsStore.js";
export { RecipeRetriever, getRetriever, _resetRetrieverForTests, type RecallResult } from "./recipeRetriever.js";
