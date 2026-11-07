import { isModernStack, stackLabel } from "./stack.js";
import type {
  Audited,
  Evidence,
  LeadCase,
  ReputationResult,
  ScoredLead,
  SocialCheck,
} from "./types.js";

// How much each finding adds to the score. Kept in one place so the weights
// are easy to tune after seeing which leads the team actually accepts.
//
// Three kinds of points:
//  - gaps we can see on the site (old site, thin online presence, no case studies...)
//  - signs the company is a good prospect even without a gap (newer tech, hiring)
//  - reputation problems found in search
export const POINTS = {
  noWebsite: 55,
  unreachable: 40,
  underConstruction: 35,

  // An old site. Capped as a group so it can't carry a lead on its own.
  noHttps: 15,
  noViewport: 20,
  copyrightVeryOld: 30,
  copyrightOld: 20,
  legacyMarkup: 15,
  missingSeoTags: 8,
  thinContent: 10,

  // Social media.
  noSocialLinks: 35,
  oneSocialLink: 10,
  noLinkedIn: 8,
  smallFollowing: 15,
  noProfileFound: 10,

  // Little public presence. These are the gaps that show up on modern, good-looking sites.
  noNewsOrBlog: 12,
  noCaseStudies: 8,
  noShareTags: 10,
  templateDefaults: 14,
  starterDomain: 12,

  negativeReputation: 35,

  // Prospect fit. Never a problem on its own, just a reason to look sooner.
  modernStack: 6,
  earlyStage: 6,
  hiring: 4,
} as const;

// The most any one group can add. Stops one kind of finding (an old site, say) from
// deciding the whole score.
export const GROUP_CAPS: Record<string, number> = {
  NoWebsite: 55,
  OutdatedWebsite: 45,
  WeakSocialPresence: 45,
  LowVisibility: 40,
  StrugglingPr: 35,
};

// Followers below this on LinkedIn count as a small following.
export const SMALL_FOLLOWING = 300;

// When two groups tie, earlier in this list wins.
const CASE_PRIORITY: LeadCase[] = [
  "NoWebsite",
  "StrugglingPr",
  "OutdatedWebsite",
  "WeakSocialPresence",
  "LowVisibility",
];

const REASON_TEXT: Record<string, string> = {
  timeout: "it took too long to respond",
  network: "the connection failed",
  http: "the server returned an error",
  "not-html": "it didn't return a web page",
  "too-many-redirects": "it kept redirecting",
};

// Never returns null: a company with no gaps still gets a (low) score, because the
// portal keeps those as "needs research" instead of losing them.
export function scoreLead(
  audited: Audited,
  reputation: ReputationResult | null,
  now: Date,
  social: SocialCheck | null = null,
): ScoredLead {
  const groups: Record<string, number> = {
    NoWebsite: 0,
    OutdatedWebsite: 0,
    WeakSocialPresence: 0,
    LowVisibility: 0,
    StrugglingPr: 0,
  };
  const evidence: Evidence[] = [];
  const context: Evidence[] = [];
  let fitPoints = 0;

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

    // A page drawn by JavaScript sends an almost empty shell. Its text, links and
    // social icons are not in what we fetched, so their absence tells us nothing.
    const readable = !site.stack.scriptRendered;

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

    if (readable && (!site.metaDescription || !site.title)) {
      add(
        "OutdatedWebsite",
        POINTS.missingSeoTags,
        "No page title or description set, which hurts how the site shows up in search.",
        site.url,
      );
    }

    if (readable && site.wordCount < 120) {
      add(
        "OutdatedWebsite",
        POINTS.thinContent,
        `Very little text on the homepage (about ${site.wordCount} words).`,
        site.url,
      );
    }

    // ---- Social media: what the site links to, plus what search found ----
    const found = social?.profiles ?? [];
    const platforms = new Set([
      ...site.socialLinks.map((l) => l.platform),
      ...found.map((p) => p.platform),
    ]);

    if (readable) {
      if (platforms.size === 0) {
        add(
          "WeakSocialPresence",
          POINTS.noSocialLinks,
          social
            ? "The site doesn't link to any social media account, and none turned up in search either."
            : "The site doesn't link to any social media account (Facebook, Instagram, LinkedIn and so on).",
          site.url,
        );
      } else if (platforms.size === 1) {
        const only = [...platforms][0];
        add(
          "WeakSocialPresence",
          POINTS.oneSocialLink,
          `Only one social account found (${only}).`,
          site.socialLinks[0]?.url ?? found[0]?.url ?? site.url,
        );
      } else if (!platforms.has("LinkedIn")) {
        add(
          "WeakSocialPresence",
          POINTS.noLinkedIn,
          "No LinkedIn page found, which matters for a company selling to other businesses.",
          site.url,
        );
      }
    } else if (social && platforms.size === 0) {
      add(
        "WeakSocialPresence",
        POINTS.noProfileFound,
        "Couldn't find any social media account for them in search (unverified, the site draws its links with JavaScript).",
        site.url,
      );
    }

    const linkedIn = found.find((p) => p.platform === "LinkedIn");
    if (
      linkedIn?.followers !== undefined &&
      linkedIn.followers < SMALL_FOLLOWING
    ) {
      add(
        "WeakSocialPresence",
        POINTS.smallFollowing,
        `Their LinkedIn page shows about ${linkedIn.followers} followers (from search results, unverified).`,
        linkedIn.url,
      );
    } else if (linkedIn) {
      context.push({
        finding:
          linkedIn.followers !== undefined
            ? `LinkedIn page found with about ${linkedIn.followers} followers (from search results, unverified).`
            : "LinkedIn page found in search. Check how active it is.",
        sourceUrl: linkedIn.url,
      });
    }

    for (const profile of found) {
      if (profile.platform === "LinkedIn") continue;
      context.push({
        finding: `${profile.platform} page found in search${profile.followers !== undefined ? ` (about ${profile.followers})` : ""}.`,
        sourceUrl: profile.url,
      });
    }

    // ---- Little public presence: the gaps that show on modern sites too ----
    if (site.templateDefaults.length > 0) {
      add(
        "LowVisibility",
        POINTS.templateDefaults,
        `The page still carries template leftovers: ${site.templateDefaults.slice(0, 2).join("; ")}.`,
        site.url,
      );
    }

    if (site.stack.starterDomain) {
      add(
        "LowVisibility",
        POINTS.starterDomain,
        `They're on a free starter address${site.stack.hosting ? ` (${site.stack.hosting})` : ""}, not their own domain.`,
        site.url,
      );
    }

    if (readable) {
      if (!site.hasNewsOrBlog) {
        add(
          "LowVisibility",
          POINTS.noNewsOrBlog,
          "No blog, news or press page linked from the homepage, so there's little for press or search to find.",
          site.url,
        );
      }

      if (!site.hasCaseStudies) {
        add(
          "LowVisibility",
          POINTS.noCaseStudies,
          "No case studies, clients or testimonials linked from the homepage.",
          site.url,
        );
      }

      if (!site.hasShareTags) {
        add(
          "LowVisibility",
          POINTS.noShareTags,
          "No share image set, so links to the site look bare when shared on LinkedIn or WhatsApp.",
          site.url,
        );
      }
    }

    // ---- Prospect fit ----
    if (isModernStack(site.stack)) {
      fitPoints += POINTS.modernStack;
      context.push({
        finding: `Newer tech stack (${stackLabel(site.stack) ?? "modern framework"}), so likely a tech-led company.`,
        sourceUrl: site.url,
      });
    }

    if (
      site.earlyStageText ||
      site.stack.starterDomain ||
      ["Lovable", "Bolt", "v0"].includes(site.stack.builder ?? "")
    ) {
      fitPoints += POINTS.earlyStage;
      context.push({
        finding:
          "Looks early-stage (beta or waitlist wording, a starter address, or an AI site builder).",
        sourceUrl: site.url,
      });
    }

    if (readable && site.hasCareers) {
      fitPoints += POINTS.hiring;
      context.push({
        finding: "Has a careers page, so they may be growing.",
        sourceUrl: site.url,
      });
    }
  }

  if (reputation?.negative) {
    groups["StrugglingPr"] =
      (groups["StrugglingPr"] ?? 0) + POINTS.negativeReputation;
    evidence.unshift(...reputation.evidence);
  }

  const needPoints = Object.entries(groups).reduce(
    (sum, [name, value]) => sum + Math.min(value, GROUP_CAPS[name] ?? value),
    0,
  );

  const capped = (name: string) =>
    Math.min(groups[name] ?? 0, GROUP_CAPS[name] ?? Infinity);
  const best = Math.max(...CASE_PRIORITY.map(capped));
  const leadCase =
    best > 0
      ? (CASE_PRIORITY.find((name) => capped(name) === best) ?? "Other")
      : "Other";

  return {
    audited,
    case: leadCase,
    score: Math.min(100, needPoints + fitPoints),
    needPoints,
    fitPoints,
    // Gaps first, then context, so the ten that fit are the ones that matter most.
    evidence: [...evidence, ...context].slice(0, 10),
  };
}
