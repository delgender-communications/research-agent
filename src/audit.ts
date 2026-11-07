import * as cheerio from "cheerio";
import type { SiteSignals, SocialLink } from "./types.js";
import {
  detectStack,
  findTemplateDefaults,
  isPlaceholderTitle,
} from "./stack.js";
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

function collectSameAs(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSameAs(item, out);
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === "sameAs") {
      for (const url of Array.isArray(inner) ? inner : [inner]) {
        if (typeof url === "string") out.push(url);
      }
    } else {
      collectSameAs(inner, out);
    }
  }
}

// Structured data in the page head (JSON-LD). Many modern sites, including ones that
// draw the page with JavaScript, still ship this in the HTML. Returns the social
// profile links it lists and its raw text, which often holds the address.
function readStructuredData($: cheerio.CheerioAPI): {
  sameAs: string[];
  text: string;
} {
  const sameAs: string[] = [];
  const texts: string[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw) return;
    texts.push(raw.slice(0, 3000));
    try {
      collectSameAs(JSON.parse(raw), sameAs);
    } catch {
      // Broken JSON-LD is common. Skip it.
    }
  });

  return { sameAs, text: texts.join(" ") };
}

function extractSocialLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  extra: string[],
): SocialLink[] {
  const found = new Map<string, SocialLink>();

  const consider = (href: string | undefined) => {
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
  };

  $("a[href]").each((_, element) => consider($(element).attr("href")));
  for (const url of extra) consider(url);

  // <meta name="twitter:site" content="@handle">
  const handle = ($('meta[name="twitter:site"]').attr("content") ?? "")
    .trim()
    .replace(/^@/, "");
  if (/^\w{1,15}$/.test(handle)) consider(`https://x.com/${handle}`);

  return [...found.values()];
}

// Does any link on the page point to a section like "Blog" or "Case studies"?
// Checks the link text (short labels only), the path, and a "blog." style subdomain.
function hasLinkMatching(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  pattern: RegExp,
): boolean {
  let found = false;

  $("a[href]").each((_, element) => {
    if (found) return;

    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (text.length > 0 && text.length <= 40 && pattern.test(text)) {
      found = true;
      return;
    }

    try {
      const url = new URL($(element).attr("href") ?? "", baseUrl);
      const target = `${url.pathname} ${url.hash}`.replace(/[/_#-]+/g, " ");
      if (
        pattern.test(target) ||
        pattern.test(url.hostname.split(".")[0] ?? "")
      )
        found = true;
    } catch {
      // Not a usable link.
    }
  });

  return found;
}

const NEWS_LINK =
  /\b(?:blog|news|insights?|articles?|press|media|updates|stories|journal|resources)\b/i;
const PROOF_LINK =
  /\b(?:case[- ]?stud(?:y|ies)|success[- ]stor(?:y|ies)|customers?|clients?|portfolio|our[- ]work|projects|testimonials?|references)\b/i;
const CAREER_LINK =
  /\b(?:careers?|jobs|join[- ]us|we['’]re[- ]hiring|work[- ]with[- ]us|vacancies)\b/i;
const EARLY_STAGE =
  /\b(?:waitlist|early access|now in beta|public beta|private beta|pre-?seed|seed round|just launched|launching soon)\b/i;

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

  // Visible text, read from a copy so the original keeps its scripts for the stack check.
  const textPage = cheerio.load(html);
  const footerText = textPage("footer").text().replace(/\s+/g, " ").trim();
  textPage("script, style, noscript").remove();
  const bodyText = textPage("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  const structured = readStructuredData($);
  const stack = detectStack(html, $, host, wordCount);

  // Footer text and structured data are added because the address is often only there.
  const relevanceText = `${title} ${metaDescription} ${bodyText.slice(0, 6000)} ${footerText.slice(0, 1500)} ${structured.text}`;
  const bodyHead = bodyText.slice(0, 3000);

  return {
    url,
    https: url.startsWith("https://"),
    title,
    siteName,
    metaDescription,
    hasViewport: $('meta[name="viewport"]').length > 0,
    copyrightYear: findCopyrightYear(`${footerText} ${bodyText}`, context.now),
    legacyMarkup,
    socialLinks: extractSocialLinks($, url, structured.sameAs),
    wordCount,
    emails: extractEmails($, bodyText, host),
    phones: extractPhones($, bodyText),
    matchesIndustry: containsKeyword(relevanceText, context.industryKeywords),
    matchesLocation: containsKeyword(relevanceText, context.locationKeywords),
    // "Coming soon" only counts when it is most of the page. A startup site that
    // mentions a feature coming soon is not an unfinished site.
    underConstruction:
      /under construction|website is (?:currently )?being (?:updated|rebuilt)|site is (?:currently )?being (?:updated|rebuilt)/i.test(
        bodyHead,
      ) ||
      (/coming soon/i.test(bodyHead) && wordCount < 150),
    stack,
    hasShareTags:
      Boolean(($('meta[property="og:image"]').attr("content") ?? "").trim()) ||
      Boolean(($('meta[name="twitter:image"]').attr("content") ?? "").trim()),
    hasNewsOrBlog: hasLinkMatching($, url, NEWS_LINK),
    hasCaseStudies: hasLinkMatching($, url, PROOF_LINK),
    hasCareers: hasLinkMatching($, url, CAREER_LINK),
    earlyStageText: EARLY_STAGE.test(bodyText.slice(0, 4000)),
    templateDefaults: findTemplateDefaults($, title, metaDescription),
    placeholderTitle: isPlaceholderTitle(title) || isPlaceholderTitle(siteName),
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
