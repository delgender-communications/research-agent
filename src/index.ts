import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditHtml, deriveCompanyName } from "./audit.js";
import {
  llmSettings,
  loadConfig,
  loadEnv,
  type AgentConfig,
} from "./config.js";
import { discover } from "./discovery.js";
import { LlmClient } from "./llm.js";
import { PortalClient } from "./portal.js";
import { checkReputation } from "./reputation.js";
import { scoreLead } from "./score.js";
import { TavilyClient } from "./search/tavily.js";
import { checkSocial } from "./social.js";
import { isPlaceholderTitle, stackLabel } from "./stack.js";
import { SeenState } from "./state.js";
import { summarise } from "./summarise.js";
import { reasonText, triage } from "./triage.js";
import type {
  Audited,
  Candidate,
  PortalLead,
  ReputationResult,
  ScoredLead,
  SiteSignals,
  SocialCheck,
  Triaged,
} from "./types.js";
import {
  cleanSocialTitle,
  clip,
  containsKeyword,
  hostOf,
  info,
  isGenericName,
  mapPool,
  warn,
} from "./util.js";
import { SafeFetcher } from "./web/safeFetch.js";

function genericWords(config: AgentConfig): string[] {
  return [
    ...config.industryKeywords,
    ...config.locationKeywords,
    ...config.genericNameWords,
    config.city,
    config.industry,
  ];
}

function snippetFits(candidate: Candidate, config: AgentConfig): boolean {
  return (
    containsKeyword(candidate.snippet, config.industryKeywords) &&
    containsKeyword(candidate.snippet, config.locationKeywords)
  );
}

// Looks at one candidate and returns null when it isn't a fit (wrong industry
// or area, blocked by robots.txt, and so on).
async function auditCandidate(
  candidate: Candidate,
  fetcher: SafeFetcher,
  config: AgentConfig,
  now: Date,
): Promise<Audited | null> {
  if (candidate.socialOnly) {
    if (!snippetFits(candidate, config)) return null;
    const name = cleanSocialTitle(candidate.nameHint);
    return name && !isGenericName(name, genericWords(config))
      ? { candidate, companyName: name }
      : null;
  }

  if (!candidate.url) return null;

  const page = await fetcher.getHtml(candidate.url);

  if (!page.ok) {
    // Not the site's fault, so not a finding.
    if (page.reason === "robots" || page.reason === "blocked-host") return null;
    // We can't read the site, so only keep it if the search result itself showed it fits.
    if (!snippetFits(candidate, config)) return null;

    const failedName = deriveCompanyName(
      "",
      candidate.nameHint,
      candidate.host,
    );
    if (isGenericName(failedName, genericWords(config))) return null;

    return {
      candidate,
      companyName: failedName,
      website: candidate.url,
      failure: { reason: page.reason, status: page.status },
    };
  }

  const site = auditHtml(page.html, page.url, {
    industryKeywords: config.industryKeywords,
    locationKeywords: config.locationKeywords,
    now,
  });

  // Modern sites often send an empty page and fill it in with JavaScript, so their own
  // text can't prove what they do or where they are. For those, the text from the search
  // result (which comes from the finished page) is used as well.
  const readable = !site.stack.scriptRendered && site.wordCount >= 120;
  const industry =
    site.matchesIndustry ||
    (!readable && containsKeyword(candidate.snippet, config.industryKeywords));
  const location =
    site.matchesLocation ||
    (!readable && containsKeyword(candidate.snippet, config.locationKeywords));
  if (!industry) return null;

  // Not confirmed in the area is no longer the end of the road, as long as they look
  // South African. Plenty of homepages never name a city. These go to research.
  if (!location && !looksSouthAfrican(site, candidate)) return null;

  const viaSnippet =
    !readable && (!site.matchesIndustry || !site.matchesLocation);

  const companyName = deriveCompanyName(
    isPlaceholderTitle(site.siteName) ? "" : site.siteName,
    isPlaceholderTitle(site.title) ? "" : site.title,
    candidate.host,
  );
  if (isGenericName(companyName, genericWords(config))) return null;

  return {
    candidate,
    companyName,
    website: new URL(site.url).origin,
    site,
    fit: { industry, location, viaSnippet },
  };
}

const SOUTH_AFRICA = /south africa|south african|\+27|\bzar\b/i;

function looksSouthAfrican(site: SiteSignals, candidate: Candidate): boolean {
  const host = candidate.host.toLowerCase();
  return (
    host.endsWith(".za") ||
    site.phones.length > 0 ||
    SOUTH_AFRICA.test(
      `${candidate.snippet} ${site.title} ${site.metaDescription}`,
    )
  );
}

// Whether a page's own links can't be trusted to show their social accounts: either the
// page is drawn by JavaScript, or it links to nothing, or to no LinkedIn page.
function worthSocialCheck(site: SiteSignals): boolean {
  return (
    site.stack.scriptRendered ||
    site.socialLinks.length === 0 ||
    !site.socialLinks.some((link) => link.platform === "LinkedIn")
  );
}

function toPortalLead(
  item: Triaged,
  summary: string,
  config: AgentConfig,
): PortalLead {
  const { lead } = item;
  const { audited } = lead;
  const label = audited.site ? stackLabel(audited.site.stack) : undefined;
  const reason = reasonText(item);

  const evidence = lead.evidence.slice(0, 10).map((entry) => ({
    finding: clip(entry.finding, 500),
    ...(entry.sourceUrl && entry.sourceUrl.length <= 1000
      ? { sourceUrl: entry.sourceUrl }
      : {}),
  }));

  return {
    companyName: clip(audited.companyName, 200),
    website: audited.website ? clip(audited.website, 300) : undefined,
    industry: config.industryLabel,
    location: config.city,
    email: audited.site?.emails[0],
    phoneNumber: audited.site?.phones[0]
      ? clip(audited.site.phones[0], 30)
      : undefined,
    case: lead.case,
    score: lead.score,
    summary: clip(summary, 1000),
    ...(item.needsResearch ? { needsResearch: true } : {}),
    ...(item.needsResearch && reason ? { researchReason: reason } : {}),
    ...(label ? { siteStack: clip(label, 120) } : {}),
    evidence,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const configIndex = args.indexOf("--config");
  const configPath =
    configIndex >= 0
      ? (args[configIndex + 1] ?? "agent.config.json")
      : "agent.config.json";

  const env = loadEnv();
  const config = loadConfig(configPath);
  const now = new Date();
  const runId = `agent-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;

  if (!dryRun && (!env.PORTAL_URL || !env.PORTAL_API_KEY)) {
    throw new Error(
      "PORTAL_URL and PORTAL_API_KEY are required unless you run with --dry-run.",
    );
  }

  const settings = llmSettings(env);
  const llm = settings ? new LlmClient(settings) : null;
  info(`Run ${runId}${dryRun ? " (dry run, nothing is sent)" : ""}`);
  info(`Looking for: ${config.industry} in ${config.city}`);
  info(
    llm
      ? `AI model: ${settings?.model}`
      : "AI model: not configured, using plain summaries and skipping reputation checks",
  );

  const reputationBudget = llm ? config.reputationChecks : 0;
  const socialBudget = config.socialChecks;
  const tavily = new TavilyClient(
    env.TAVILY_API_KEY,
    env.TAVILY_BASE_URL,
    config.maxSearchesPerRun,
    config.country,
    config.resultsPerSearch,
  );

  const fetcher = new SafeFetcher({
    userAgent: `DelgenderResearchBot/0.1 (public business research${env.CONTACT ? `; ${env.CONTACT}` : ""})`,
    allowPrivateHosts: env.ALLOW_PRIVATE_HOSTS === "true",
  });

  const state = new SeenState(env.STATE_FILE, now);

  // 1. Find candidates
  info("\n1. Searching");
  const fresh = await discover(
    config,
    tavily,
    fetcher,
    now,
    reputationBudget + socialBudget,
    (host) => state.has(host),
  );

  // 2. Look at each one
  info("\n2. Checking websites");
  const audits = await mapPool(fresh, 4, async (candidate) => {
    const audited = await auditCandidate(candidate, fetcher, config, now);
    state.mark(candidate.host);
    return audited;
  });
  const audited = audits.filter((item): item is Audited => item !== null);
  info(
    `  ${audited.length} fit the industry (${audited.filter((item) => item.fit && !item.fit.location).length} without a confirmed area)`,
  );
  info(
    `  ${audited.filter((item) => item.site?.stack.scriptRendered).length} are drawn by JavaScript`,
  );

  const preScored = audited
    .map((item) => ({ item, pre: scoreLead(item, null, now).score }))
    .sort((a, b) => b.pre - a.pre);

  // 3. Look for social accounts the website can't show us
  const socials = new Map<Audited, SocialCheck>();
  if (socialBudget > 0) {
    info("\n3. Looking for social accounts");
    const targets = preScored
      .filter(({ item }) => item.site && worthSocialCheck(item.site))
      .slice(0, socialBudget);

    for (const { item } of targets) {
      if (tavily.searchesLeft === 0) break;
      const ownHost = item.website ? hostOf(item.website) : null;
      try {
        const result = await checkSocial(
          item.companyName,
          ownHost,
          config,
          tavily,
        );
        if (result) socials.set(item, result);
      } catch (error) {
        warn(
          `Social check skipped for ${item.companyName}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  // 4. Reputation check for the most promising few
  const reputation = new Map<Audited, ReputationResult>();
  if (reputationBudget > 0) {
    info("\n4. Checking reputation");
    const ranked = preScored
      .filter((entry) => entry.pre > 0)
      .slice(0, reputationBudget);

    for (const { item } of ranked) {
      if (tavily.searchesLeft === 0) break;
      const ownHost = item.website ? hostOf(item.website) : null;
      try {
        const result = await checkReputation(
          item.companyName,
          ownHost,
          config,
          tavily,
          llm,
        );
        if (result) reputation.set(item, result);
      } catch (error) {
        warn(
          `Reputation check skipped for ${item.companyName}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  // 5. Score everything, then split into Recommended and Needs research
  const scored: ScoredLead[] = audited.map((item) =>
    scoreLead(
      item,
      reputation.get(item) ?? null,
      now,
      socials.get(item) ?? null,
    ),
  );

  const { recommended, research } = triage(scored, {
    minScore: config.minScore,
    researchMinScore: config.researchMinScore,
    maxLeads: config.maxLeadsPerRun,
    maxResearch: config.maxResearchPerRun,
    city: config.city,
  });

  info(
    `\n5. ${recommended.length} recommended (score ${config.minScore}+), ${research.length} need research`,
  );

  // 6. Write the notes
  const triaged = [...recommended, ...research];
  let summaries: Awaited<ReturnType<typeof summarise>>;
  try {
    summaries = await summarise(triaged, llm);
  } catch (error) {
    warn(
      "Writing the notes with the AI model failed, using plain notes:",
      error instanceof Error ? error.message : error,
    );
    summaries = await summarise(triaged, null);
  }
  const leads = triaged.map((item) =>
    toPortalLead(item, summaries.get(item) ?? "", config),
  );

  mkdirSync(env.OUT_DIR, { recursive: true });
  const outFile = join(env.OUT_DIR, `${runId}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        runId,
        searchesUsed: tavily.searchesUsed,
        checked: audited.length,
        recommended: recommended.length,
        needsResearch: research.length,
        leads,
      },
      null,
      2,
    ),
  );
  info(`  saved ${outFile}`);

  for (const lead of leads) {
    const tag = lead.needsResearch ? "research" : "recommend";
    info(
      `  ${String(lead.score).padStart(3)}  ${tag.padEnd(9)} ${lead.case.padEnd(18)} ${lead.companyName}${lead.siteStack ? `  [${lead.siteStack}]` : ""}`,
    );
  }

  // 7. Send to the portal
  let failed = false;
  if (dryRun) {
    info("\nDry run: nothing sent to the portal.");
  } else if (leads.length === 0) {
    info("\nNothing to send.");
  } else {
    info("\n7. Sending to the portal");
    const portal = new PortalClient(
      env.PORTAL_URL as string,
      env.PORTAL_API_KEY as string,
    );
    const report = await portal.send(leads, runId);

    info(
      `  added ${report.added}, skipped ${report.skipped.length}, failed ${report.failed.length}`,
    );
    for (const item of report.skipped)
      info(`  skipped ${item.companyName}: ${item.reason}`);
    for (const item of report.failed)
      warn(`failed ${item.companyName}: ${item.error}`);
    failed = report.failed.length > 0;
  }

  // Only remember what we've seen once a real run has worked. A dry run leaves no trace.
  if (!failed && !dryRun) state.save();
  info(
    `\nDone. Searches used: ${tavily.searchesUsed}/${config.maxSearchesPerRun}.`,
  );
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
