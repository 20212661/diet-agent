/**
 * Immutable prefix caching — maximizes prompt cache hit rate.
 *
 * 1. Tool specs are sorted by name (codepoint comparison, not localeCompare)
 *    so the serialized JSON is byte-identical across turns.
 * 2. The system prompt is split into a static prefix (core prompt + skill
 *    index + user ID) computed once, and a dynamic suffix (user memory +
 *    recipes) rebuilt only when content actually changes (hash comparison).
 * 3. When the full string is byte-identical between turns, the API provider's
 *    prefix cache hits and skips re-processing those tokens.
 */

import { createHash } from "node:crypto";

export function sortToolsByName<T extends { name: string }>(
  tools: readonly T[],
): T[] {
  return [...tools].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class UserPrefixCache {
  private readonly _staticPrefix: string;
  private _dynamicHash: string | null = null;
  private _cachedPrompt: string | null = null;

  constructor(
    private readonly _userId: string,
    staticParts: string[],
    private readonly _buildDynamic: (userId: string) => string,
  ) {
    this._staticPrefix = staticParts.filter(Boolean).join("\n\n");
  }

  get(): string {
    const dynamic = this._buildDynamic(this._userId);
    const hash = stableHash(dynamic);

    if (hash === this._dynamicHash && this._cachedPrompt !== null) {
      return this._cachedPrompt;
    }

    this._dynamicHash = hash;
    this._cachedPrompt = this._staticPrefix + "\n\n" + dynamic;
    return this._cachedPrompt;
  }
}
