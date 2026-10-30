/** Only exact mass/volume units can be converted; package sizes remain unknown. */
export function parseQuantity(text: string): { value: number; unit: string } | null {
  const match = /^(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|斤|毫升|ml|升|l|个|盒|包|把)$/i.exec(text.trim());
  if (!match) return null;
  const factors: Record<string, [string, number]> = {
    千克: ["g", 1000], 公斤: ["g", 1000], kg: ["g", 1000], 克: ["g", 1], g: ["g", 1], 斤: ["g", 500],
    毫升: ["ml", 1], ml: ["ml", 1], 升: ["ml", 1000], l: ["ml", 1000],
  };
  const rawUnit = match[2].toLowerCase();
  // A box/bag/bunch count does not establish compatible package specifications.
  if (["盒", "包", "把"].includes(rawUnit)) return null;
  const [unit, factor] = factors[rawUnit] ?? [rawUnit, 1];
  const value = Number(match[1]) * factor;
  return Number.isFinite(value) && value > 0 ? { value, unit } : null;
}
export function combinedAmount(left: string, right: string): string | null {
  const a = parseQuantity(left), b = parseQuantity(right);
  if (!a || !b || a.unit !== b.unit) return null;
  return `${Number((a.value + b.value).toFixed(6))} ${a.unit === "g" ? "克" : a.unit === "ml" ? "毫升" : a.unit}`;
}
