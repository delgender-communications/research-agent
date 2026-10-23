import * as cheerio from "cheerio";
import type { SiteSignals, SocialLink } from "./types.js";
import { containsKeyword, normalizeHost, registrableHost } from "./util.js";

const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "tiktok.com": "TikTok",
  "twitter.com": "X",
  "x.com": "X",
  "youtube.com": "YouTube",
};

const SHARE_LINK = /sharer|\/share|intent\/tweet|shareArticle|dialog\/share/i;

export function platformOf(url: string): string | null {
  try {
    const host = normalizeHost(new URL(url).hostname);
    for (const [domain, platform] of Object.entries(SOCIAL_HOSTS)) {
      if (host === domain || host.endsWith("." + domain)) return platform;
    }
  } catch {
    // Not a usable link.
  }
  return null;
}

function extractSocialLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): SocialLink[] {
  const found = new Map<string, SocialLink>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || SHARE_LINK.test(href)) return;

    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    const platform = platformOf(absolute);
    if (platform && !found.has(platform)) {
      found.set(platform, { platform, url: absolute });
    }
  });

  return [...found.values()];
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+27|0)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}/g;

// Only keep addresses on the company's own domain: those are business
// contacts, not someone's personal inbox.
function extractEmails(
  $: cheerio.CheerioAPI,
  text: string,
  host: string,
): string[] {
  const candidates = new Set<string>();

  $('a[href^="mailto:"]').each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const address = href
      .replace(/^mailto:/i, "")
      .split("?")[0]
      ?.trim();
    if (address) candidates.add(address.toLowerCase());
  });

  for (const match of text.match(EMAIL_PATTERN) ?? []) {
    candidates.add(match.toLowerCase());
  }

  const own = registrableHost(host);
  return [...candidates]
    .filter((email) => {
      const domain = email.split("@")[1];
      return domain !== undefined && registrableHost(domain) === own;
    })
    .slice(0, 3);
}

function extractPhones($: cheerio.CheerioAPI, text: string): string[] {
  const candidates = new Set<string>();

  $('a[href^="tel:"]').each((_, element) => {
    const raw = ($(element).attr("href") ?? "").replace(/^tel:/i, "").trim();
    if (/^(?:\+27|0)[\d\s()-]{8,}$/.test(raw)) candidates.add(raw);
  });

  for (const match of text.match(PHONE_PATTERN) ?? []) {
    candidates.add(match.trim());
  }

  return [...candidates].slice(0, 2);
}

export function findCopyrightYear(text: string, now: Date): number | null {
  const pattern =
    /(?:©|&copy;|copyright)\s*(?:\(c\)\s*)?(\d{4})(?:\s*[-–]\s*(\d{4}))?/gi;
  const maxYear = now.getUTCFullYear() + 1;
  let latest: number | null = null;

  for (const match of text.matchAll(pattern)) {
    for (const raw of [match[1], match[2]]) {
      const year = raw ? Number(raw) : NaN;
      if (
        year >= 1995 &&
        year <= maxYear &&
        (latest === null || year > latest)
      ) {
        latest = year;
      }
    }
  }

  return latest;
}

export interface AuditContext {
  industryKeywords: string[];
  locationKeywords: string[];
  now: Date;
}

export function auditHtml(
  html: string,
  url: string,
  context: AuditContext,
): SiteSignals {
  const $ = cheerio.load(html);
  const host = normalizeHost(new URL(url).hostname);

  const legacyMarkup: string[] = [];
  if ($("font").length > 0) legacyMarkup.push("font tags");
  if ($("center").length > 0) legacyMarkup.push("center tags");
  if ($("marquee").length > 0) legacyMarkup.push("marquee");
  if ($("frameset, frame").length > 0) legacyMarkup.push("frames");
  if ($('embed[src$=".swf"], object[data$=".swf"]').length > 0)
    legacyMarkup.push("Flash");

  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const siteName = (
    $('meta[property="og:site_name"]').attr("content") ?? ""
  ).trim();
  const metaDescription = (
    $('meta[name="description"]').attr("content") ??
    $('meta[property="og:description"]').attr("content") ??
    ""
  ).trim();

  const footerText = $("footer").text();
  $("script, style, noscript").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  const relevanceText = `${title} ${metaDescription} ${bodyText.slice(0, 6000)}`;

  return {
    url,
    https: url.startsWith("https://"),
    title,
    siteName,
    metaDescription,
    hasViewport: $('meta[name="viewport"]').length > 0,
    copyrightYear: findCopyrightYear(`${footerText} ${bodyText}`, context.now),
    legacyMarkup,
    socialLinks: extractSocialLinks($, url),
    wordCount,
    emails: extractEmails($, bodyText, host),
    phones: extractPhones($, bodyText),
    matchesIndustry: containsKeyword(relevanceText, context.industryKeywords),
    matchesLocation: containsKeyword(relevanceText, context.locationKeywords),
    underConstruction:
      /under construction|coming soon|website is (?:currently )?being (?:updated|rebuilt)|site is (?:currently )?being (?:updated|rebuilt)/i.test(
        bodyText.slice(0, 3000),
      ),
  };
}

const GENERIC_NAMES = new Set(["home", "welcome", "homepage", "index", "main"]);

function labelMatches(segment: string, hostLabel: string): boolean {
  const flat = segment.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    flat.length > 2 && (flat.includes(hostLabel) || hostLabel.includes(flat))
  );
}

// Page titles look like "Home | Sunpower Solar - Johannesburg". Pick the part that
// is the company name, preferring the one that matches the web address.
export function deriveCompanyName(
  siteName: string,
  title: string,
  host: string,
): string {
  if (siteName.trim()) return siteName.trim();

  const hostLabel = (host.split(".")[0] ?? "").replace(/[^a-z0-9]/g, "");
  const segments = title
    .split(/\s[|\-–—:•·]\s|\s*[|•·]\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !GENERIC_NAMES.has(segment.toLowerCase()));

  const matching = segments.find((segment) => labelMatches(segment, hostLabel));
  if (matching) return matching;
  if (segments[0]) return segments[0];

  return hostLabel
    ? hostLabel.charAt(0).toUpperCase() + hostLabel.slice(1)
    : host;
}
