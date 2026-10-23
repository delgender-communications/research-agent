import * as cheerio from "cheerio";
import { platformOf } from "./audit.js";
import type { AgentConfig } from "./config.js";
import { SearchLimitReached, type TavilyClient } from "./search/tavily.js";
import type { Candidate, SearchHit } from "./types.js";
import { SafeFetcher } from "./web/safeFetch.js";
import {
  cleanSocialTitle,
  info,
  isBusinessSocialPage,
  nameKey,
  normalizeHost,
  registrableHost,
  warn,
} from "./util.js";

// Sites that show up in results but are never a company we'd approach.
const NOISE_HOSTS = [
  "wikipedia.org",
  "reddit.com",
  "quora.com",
  "medium.com",
  "pinterest.com",
  "gumtree.com",
  "gumtree.co.za",
  "olx.co.za",
  "takealot.com",
  "amazon.com",
  "hellopeter.com",
  "trustpilot.com",
  "tripadvisor.com",
  "yelp.com",
  "news24.com",
  "iol.co.za",
  "businesslive.co.za",
  "dailymaverick.co.za",
  "moneyweb.co.za",
  "mybroadband.co.za",
  "citizen.co.za",
  "timeslive.co.za",
  "techcentral.co.za",
  "eskom.co.za",
  "nersa.org.za",
  "gov.za",
  "google.com",
  "bing.com",
  "wa.me",
  "whatsapp.com",
  "apple.com",
  "play.google.com",
  "youtube.com",
  "linkedin.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "bit.ly",
  "goo.gl"
];

// Business directories: not companies themselves, but they link to many of them.
const DIRECTORY_HOSTS = [
  "yellowpages.co.za",
  "brabys.com",
  "cylex-sa.com",
  "hotfrog.co.za",
  "snupit.co.za",
  "findit.co.za",
  "localsearch.co.za",
  "easyinfo.co.za",
  "bizcommunity.com",
];

const DIRECTORY_TITLE =
  /\b(?:top|best)\s+\d+\b|\bdirectory\b|\blist of\b|\bcompanies (?:in|near)\b|\bnear me\b|\bcompare quotes\b/i;

const FACEBOOK_HOSTS = ["facebook.com", "fb.com", "instagram.com"];

function hostMatches(host: string, list: string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith("." + entry));
}

export type HitKind = "noise" | "directory" | "social" | "site";

export function classifyHit(
  hit: SearchHit,
  extraNoiseHosts: string[] = [],
): HitKind {
  let host: string;
  try {
    host = normalizeHost(new URL(hit.url).hostname);
  } catch {
    return "noise";
  }

  if (hostMatches(host, FACEBOOK_HOSTS)) return "social";
  if (hostMatches(host, NOISE_HOSTS) || hostMatches(host, extraNoiseHosts))
    return "noise";
  if (hostMatches(host, DIRECTORY_HOSTS) || DIRECTORY_TITLE.test(hit.title))
    return "directory";
  return "site";
}

// Spreads suburbs across runs so each run asks about different places.
export function buildQueries(
  config: AgentConfig,
  now: Date,
  limit: number,
): string[] {
  const dayOfYear = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );

  const queries: string[] = [];
  let suburbCursor = dayOfYear;

  for (const template of config.queryTemplates) {
    let query = template
      .replaceAll("{industry}", config.industry)
      .replaceAll("{city}", config.city);

    if (query.includes("{suburb}")) {
      if (config.suburbs.length === 0) continue;
      const suburb = config.suburbs[
        suburbCursor % config.suburbs.length
      ] as string;
      suburbCursor++;
      query = query.replaceAll("{suburb}", suburb);
    }

    if (!queries.includes(query)) queries.push(query);
  }

  return queries.slice(0, limit);
}

function homepageOf(url: string): { host: string; homepage: string } | null {
  try {
    const parsed = new URL(url);
    return {
      host: normalizeHost(parsed.hostname),
      homepage: `${parsed.protocol}//${parsed.host}/`,
    };
  } catch {
    return null;
  }
}

async function expandDirectory(
  hit: SearchHit,
  fetcher: SafeFetcher,
  limit: number,
  extraNoiseHosts: string[],
): Promise<Candidate[]> {
  const page = await fetcher.getHtml(hit.url);
  if (!page.ok) return [];

  const $ = cheerio.load(page.html);
  const sourceHost = registrableHost(new URL(hit.url).hostname);
  const seen = new Set<string>();
  const found: Candidate[] = [];

  $("a[href]").each((_, element) => {
    if (found.length >= limit) return;

    const href = $(element).attr("href");
    if (!href) return;

    let absolute: URL;
    try {
      absolute = new URL(href, page.url);
    } catch {
      return;
    }

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;

    const host = normalizeHost(absolute.hostname);
    if (registrableHost(host) === sourceHost) return;
    if (
      hostMatches(host, NOISE_HOSTS) ||
      hostMatches(host, extraNoiseHosts) ||
      hostMatches(host, DIRECTORY_HOSTS) ||
      hostMatches(host, FACEBOOK_HOSTS) ||
      platformOf(absolute.toString())
    ) {
      return;
    }

    const key = registrableHost(host);
    if (seen.has(key)) return;
    seen.add(key);

    found.push({
      host,
      url: `${absolute.protocol}//${absolute.host}/`,
      nameHint: $(element).text().replace(/\s+/g, " ").trim(),
      snippet: "",
      via: `directory ${sourceHost}`,
    });
  });

  return found;
}

export async function discover(
  config: AgentConfig,
  tavily: TavilyClient,
  fetcher: SafeFetcher,
  now: Date,
  reservedSearches: number,
): Promise<Candidate[]> {
  const queries = buildQueries(
    config,
    now,
    Math.max(1, tavily.searchesLeft - reservedSearches),
  );
  const byHost = new Map<string, Candidate>();
  const socialOnly: Candidate[] = [];
  const directories: SearchHit[] = [];

  for (const query of queries) {
    let hits: SearchHit[];
    try {
      hits = await tavily.search(query);
    } catch (error) {
      if (error instanceof SearchLimitReached) break;
      throw error;
    }

    for (const hit of hits) {
      const kind = classifyHit(hit, config.excludeHosts);

      if (kind === "noise") continue;

      if (kind === "directory") {
        if (!directories.some((existing) => existing.url === hit.url))
          directories.push(hit);
        continue;
      }

      if (kind === "social") {
        const platform = platformOf(hit.url);
        const host = homepageOf(hit.url)?.host;
        if (!platform || !host || !isBusinessSocialPage(hit.url)) continue;
        const name = cleanSocialTitle(hit.title);
        if (!name) continue;
        socialOnly.push({
          host: `${host}/${nameKey(name)}`,
          nameHint: name,
          socialOnly: { url: hit.url, platform },
          snippet: `${hit.title} ${hit.content}`,
          via: query,
        });
        continue;
      }

      const home = homepageOf(hit.url);
      if (!home || byHost.has(home.host)) continue;
      byHost.set(home.host, {
        host: home.host,
        url: home.homepage,
        nameHint: hit.title,
        snippet: `${hit.title} ${hit.content}`,
        via: query,
      });
    }
  }

  // Directories link out to many companies at once, so they are worth a look.
  for (const hit of directories.slice(0, 3)) {
    const expanded = await expandDirectory(
      hit,
      fetcher,
      15,
      config.excludeHosts,
    );
    info(`  directory ${hit.url}: ${expanded.length} companies`);
    for (const candidate of expanded) {
      if (!byHost.has(candidate.host)) byHost.set(candidate.host, candidate);
    }
  }

  // A social page only counts as "no website" when we found no site for that name.
  const siteNames = new Set(
    [...byHost.values()].map((c) => nameKey(c.nameHint)),
  );
  const result = [...byHost.values()];

  for (const candidate of socialOnly) {
    const key = nameKey(candidate.nameHint);
    if (
      key &&
      !siteNames.has(key) &&
      !result.some((c) => c.host === candidate.host)
    ) {
      result.push(candidate);
    }
  }

  if (result.length === 0) warn("Discovery found no candidates.");
  return result.slice(0, config.maxSitesToAudit);
}
