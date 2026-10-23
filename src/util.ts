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
  "co.za",
  "org.za",
  "net.za",
  "web.za",
  "gov.za",
  "ac.za",
  "com.au",
  "co.uk",
  "co.nz",
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
  "pty",
  "ltd",
  "limited",
  "inc",
  "llc",
  "cc",
  "co",
  "corp",
  "corporation",
  "proprietary",
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
    const escaped = keyword
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`,
      "u",
    ).test(lower);
  });
}

// "Sunbright Solar | Roodepoort | Facebook" -> "Sunbright Solar"
export function cleanSocialTitle(title: string): string {
  const withoutPlatform = title
    .replace(/\s*[|\-–—]\s*(?:facebook|instagram)\b.*$/i, "")
    .replace(/\s*[|\-–—]\s*(?:home|posts|about|photos|reviews)\s*$/i, "")
    .trim();

  // "Business name | Suburb": keep the business name.
  const [first] = withoutPlatform.split(/\s[|–—·]\s|\s-\s/);
  return (first ?? withoutPlatform).trim();
}

const GENERIC_WORDS = new Set([
  "panel",
  "panels",
  "installation",
  "installations",
  "installer",
  "installers",
  "install",
  "company",
  "companies",
  "service",
  "services",
  "quote",
  "quotes",
  "quotation",
  "quotations",
  "in",
  "for",
  "near",
  "and",
  "the",
  "of",
  "a",
  "to",
  "best",
  "top",
  "price",
  "prices",
  "cost",
  "costs",
  "home",
  "homes",
  "business",
  "businesses",
  "commercial",
  "residential",
  "official",
  "page",
]);

// True for names that are really search phrases or page headings ("Solar panel
// installation quotes in Midrand", "reputable solar installer in johannesburg?")
// and not the name of a company. `ignore` holds the industry and place words.
export function isGenericName(name: string, ignore: string[]): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 80 || trimmed.endsWith("?"))
    return true;
  if (
    /^(?:best|top|reputable|affordable|cheap|cheapest|find|looking for|need|where|who|how|what|why)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  const split = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const ignored = new Set(ignore.flatMap(split));
  return split(trimmed).every(
    (word) => GENERIC_WORDS.has(word) || ignored.has(word),
  );
}

// Facebook and Instagram results include posts, groups, reels and photos.
// Only the page of a business or person is worth treating as a company.
export function isBusinessSocialPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = parsed.pathname.toLowerCase();
  const blocked = [
    "/posts",
    "/groups",
    "/permalink",
    "/watch",
    "/reel",
    "/reels",
    "/photo",
    "/photos",
    "/videos",
    "/events",
    "/story",
    "/stories",
    "/share",
    "/hashtag",
    "/marketplace",
    "/explore",
    "/tags",
    "/p/",
    "/tv/",
    "/pages/category",
    "/public",
  ];
  if (blocked.some((part) => path.includes(part))) return false;

  const segments = path.split("/").filter(Boolean);
  return segments.length >= 1 && segments.length <= 2;
}
