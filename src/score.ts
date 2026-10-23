import type {
  Audited,
  Evidence,
  LeadCase,
  ReputationResult,
  ScoredLead,
} from "./types.js";

// How much each finding adds to the score. Kept in one place so the weights
// are easy to tune after seeing which leads the team actually accepts.
export const POINTS = {
  noWebsite: 55,
  unreachable: 40,
  underConstruction: 35,
  noHttps: 15,
  noViewport: 20,
  copyrightVeryOld: 30,
  copyrightOld: 20,
  legacyMarkup: 15,
  missingSeoTags: 8,
  thinContent: 10,
  noSocialLinks: 35,
  oneSocialLink: 10,
  negativeReputation: 35,
} as const;

// When two groups tie, earlier in this list wins.
const CASE_PRIORITY: LeadCase[] = [
  "NoWebsite",
  "StrugglingPr",
  "OutdatedWebsite",
  "WeakSocialPresence",
];

const REASON_TEXT: Record<string, string> = {
  timeout: "it took too long to respond",
  network: "the connection failed",
  http: "the server returned an error",
  "not-html": "it didn't return a web page",
  "too-many-redirects": "it kept redirecting",
};

export function scoreLead(
  audited: Audited,
  reputation: ReputationResult | null,
  now: Date,
): ScoredLead | null {
  const groups: Record<string, number> = {
    NoWebsite: 0,
    OutdatedWebsite: 0,
    WeakSocialPresence: 0,
    StrugglingPr: 0,
  };
  const evidence: Evidence[] = [];

  const add = (
    group: string,
    points: number,
    finding: string,
    sourceUrl?: string,
  ) => {
    groups[group] = (groups[group] ?? 0) + points;
    evidence.push(sourceUrl ? { finding, sourceUrl } : { finding });
  };

  const { candidate, site, failure } = audited;

  if (candidate.socialOnly) {
    add(
      "NoWebsite",
      POINTS.noWebsite,
      `Search only turned up a ${candidate.socialOnly.platform} page for them, and we didn't find a website. Check before approaching.`,
      candidate.socialOnly.url,
    );
  }

  if (failure) {
    const why =
      REASON_TEXT[failure.reason] ??
      (failure.status
        ? `it answered with error ${failure.status}`
        : "it could not be reached");
    add(
      "OutdatedWebsite",
      POINTS.unreachable,
      `The website didn't load when we checked (${why}). It may just have been down, so check it.`,
      audited.website,
    );
  }

  if (site) {
    const year = now.getUTCFullYear();

    if (site.underConstruction) {
      add(
        "OutdatedWebsite",
        POINTS.underConstruction,
        "The homepage says the site is under construction or coming soon.",
        site.url,
      );
    }

    if (!site.https) {
      add(
        "OutdatedWebsite",
        POINTS.noHttps,
        "The site loads over http, not secure https, so browsers warn visitors.",
        site.url,
      );
    }

    if (!site.hasViewport) {
      add(
        "OutdatedWebsite",
        POINTS.noViewport,
        "Not mobile-friendly: the page has no mobile display setting.",
        site.url,
      );
    }

    if (site.copyrightYear !== null) {
      const age = year - site.copyrightYear;
      if (age >= 6) {
        add(
          "OutdatedWebsite",
          POINTS.copyrightVeryOld,
          `The footer copyright says ${site.copyrightYear}, so the site looks untouched for about ${age} years.`,
          site.url,
        );
      } else if (age >= 3) {
        add(
          "OutdatedWebsite",
          POINTS.copyrightOld,
          `The footer copyright says ${site.copyrightYear}, so the site hasn't been refreshed in a few years.`,
          site.url,
        );
      }
    }

    if (site.legacyMarkup.length > 0) {
      add(
        "OutdatedWebsite",
        POINTS.legacyMarkup,
        `Built with old page markup (${site.legacyMarkup.join(", ")}).`,
        site.url,
      );
    }

    if (!site.metaDescription || !site.title) {
      add(
        "OutdatedWebsite",
        POINTS.missingSeoTags,
        "No page title or description set, which hurts how the site shows up in search.",
        site.url,
      );
    }

    if (site.wordCount < 120) {
      add(
        "OutdatedWebsite",
        POINTS.thinContent,
        `Very little text on the homepage (about ${site.wordCount} words).`,
        site.url,
      );
    }

    if (site.socialLinks.length === 0) {
      add(
        "WeakSocialPresence",
        POINTS.noSocialLinks,
        "The site doesn't link to any social media account (Facebook, Instagram, LinkedIn and so on).",
        site.url,
      );
    } else if (site.socialLinks.length === 1) {
      const only = site.socialLinks[0];
      add(
        "WeakSocialPresence",
        POINTS.oneSocialLink,
        `The site only links to one social account (${only?.platform}).`,
        only?.url ?? site.url,
      );
    }
  }

  if (reputation?.negative) {
    groups["StrugglingPr"] =
      (groups["StrugglingPr"] ?? 0) + POINTS.negativeReputation;
    evidence.unshift(...reputation.evidence);
  }

  const total = Object.values(groups).reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;

  const best = Math.max(...Object.values(groups));
  const leadCase =
    CASE_PRIORITY.find((name) => groups[name] === best) ?? "Other";

  return {
    audited,
    case: leadCase,
    score: Math.min(100, total),
    evidence: evidence.slice(0, 10),
  };
}
