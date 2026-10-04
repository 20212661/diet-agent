import { randomUUID } from "node:crypto";

export function nowISO(): string {
  return new Date().toISOString();
}

export function nextUpdatedAt(previous?: string): string {
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

export function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function generateId(prefix = "rec"): string {
  return `${prefix}_${randomUUID()}`;
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? []);
}

export function parseJsonArray<T>(value: string | null | undefined, fallback: T[] = []): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
