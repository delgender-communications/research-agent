import { isIP } from "node:net";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const info = (...args: unknown[]) => console.log(...args);
export const warn = (...args: unknown[]) => console.warn("WARN", ...args);

export function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= max
    ? trimmed
    : trimmed.slice(0, max - 1).trimEnd() + "…";
}

// Runs fn over items with at most `size` running at once, keeping result order.
export async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, () => worker()),
  );
  return results;
}

export function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

const TWO_PART_SUFFIXES = [
  "co.za", "org.za", "net.za", "web.za", "gov.za", "ac.za", "com.au", "co.uk", "co.nz",
];

// "shop.example.co.za" -> "example.co.za". Good enough for telling companies apart.
export function registrableHost(host: string): string {
  const lower = normalizeHost(host);
  if (isIP(lower)) return lower;

  const labels = lower.split(".");
  const keep = TWO_PART_SUFFIXES.some((suffix) => lower.endsWith("." + suffix))
    ? 3
    : 2;
  return labels.slice(-keep).join(".");
}

export function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

const IGNORED_NAME_WORDS = new Set([
  "pty", "ltd", "limited", "inc", "llc", "cc", "co", "corp", "corporation", "proprietary",
]);

// Same idea as the portal's duplicate check, so names line up on both sides.
export function nameKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word && !IGNORED_NAME_WORDS.has(word));

  if (words.length > 1 && words[0] === "the") words.shift();
  return words.join("");
}

export function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(
      lower,
    );
  });
}

// "Sunbright Solar | Facebook" -> "Sunbright Solar"
export function cleanSocialTitle(title: string): string {
  return title
    .replace(/\s*[|\-–—]\s*(?:facebook|instagram)\b.*$/i, "")
    .replace(/\s*[|\-–—]\s*(?:home|posts|about|photos|reviews)\s*$/i, "")
    .trim();
}
