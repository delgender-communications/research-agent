import { platformOf } from "./audit.js";
import type { AgentConfig } from "./config.js";
import type { TavilyClient } from "./search/tavily.js";
import type { SearchHit, SocialCheck, SocialProfile } from "./types.js";
import { isBusinessSocialPage, nameKey, registrableHost } from "./util.js";

// Turns "1,234 followers", "12K followers" or "1.2K Followers" into a number.
// Facebook pages say "likes" instead, which is close enough for a rough size.
export function parseFollowers(text: string): number | undefined {
  const match = text.match(
    /(\d[\d,. ]*\d|\d)\s*([kKmM])?\+?\s*(?:followers|likes)\b/i,
  );
  if (!match) return undefined;

  const digits = match[1] ?? "";
  const suffix = (match[2] ?? "").toLowerCase();

  if (suffix) {
    const value = Number.parseFloat(digits.replace(/[, ]/g, ""));
    return Number.isFinite(value)
      ? Math.round(value * (suffix === "m" ? 1_000_000 : 1_000))
      : undefined;
  }

  const value = Number.parseInt(digits.replace(/[,. ]/g, ""), 10);
  return Number.isFinite(value) ? value : undefined;
}

function mentionsCompany(hit: SearchHit, key: string): boolean {
  const flat = `${hit.title} ${hit.content}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return key.length >= 4 && flat.includes(key);
}

// A LinkedIn company page, or the Facebook/Instagram page of a business.
// Posts, groups, people and jobs are not company profiles.
function profileOf(hit: SearchHit): { platform: string; url: string } | null {
  const platform = platformOf(hit.url);
  if (!platform) return null;

  let path: string;
  try {
    path = new URL(hit.url).pathname.toLowerCase();
  } catch {
    return null;
  }

  if (platform === "LinkedIn") {
    return /^\/company\/[^/]+\/?$/.test(path)
      ? { platform, url: hit.url }
      : null;
  }

  if (platform === "Facebook" || platform === "Instagram") {
    return isBusinessSocialPage(hit.url) ? { platform, url: hit.url } : null;
  }

  return null;
}

// One search for the company's social accounts. Used where the website itself can't
// tell us: pages drawn by JavaScript, and sites that link to no LinkedIn page.
// Results are unverified, so the portal shows them as a link to check.
export async function checkSocial(
  companyName: string,
  ownHost: string | null,
  config: AgentConfig,
  tavily: TavilyClient,
): Promise<SocialCheck | null> {
  if (tavily.searchesLeft === 0) return null;

  const key = nameKey(companyName);
  const own = ownHost ? registrableHost(ownHost) : null;
  const hits = await tavily.search(
    `"${companyName}" ${config.city} LinkedIn Facebook Instagram`,
  );

  const profiles = new Map<string, SocialProfile>();

  for (const hit of hits) {
    const profile = profileOf(hit);
    if (!profile || profiles.has(profile.platform)) continue;

    // The page has to be about this company, by its name in the text or the address.
    const slug = (() => {
      try {
        return new URL(hit.url).pathname
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");
      } catch {
        return "";
      }
    })();
    const aboutThem =
      mentionsCompany(hit, key) || (key.length >= 4 && slug.includes(key));
    if (!aboutThem) continue;

    // Ignore a result that is just the company's own site.
    if (own && registrableHost(new URL(hit.url).hostname) === own) continue;

    const followers = parseFollowers(`${hit.title} ${hit.content}`);
    profiles.set(profile.platform, {
      platform: profile.platform,
      url: profile.url,
      ...(followers !== undefined ? { followers } : {}),
    });
  }

  return { profiles: [...profiles.values()] };
}
