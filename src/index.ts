import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditHtml, deriveCompanyName } from "./audit.js";
import { llmSettings, loadConfig, loadEnv, type AgentConfig } from "./config.js";
import { discover } from "./discovery.js";
import { LlmClient } from "./llm.js";
import { PortalClient } from "./portal.js";
import { checkReputation } from "./reputation.js";
import { scoreLead } from "./score.js";
import { TavilyClient } from "./search/tavily.js";
import { SeenState } from "./state.js";
import { summarise } from "./summarise.js";
import type { Audited, Candidate, PortalLead, ReputationResult, ScoredLead } from "./types.js";
import { cleanSocialTitle, clip, containsKeyword, hostOf, info, isGenericName, mapPool, warn } from "./util.js";
import { SafeFetcher } from "./web/safeFetch.js";

function genericWords(config: AgentConfig): string[] {
  return [...config.industryKeywords, ...config.locationKeywords, config.city, config.industry];
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
    return name && !isGenericName(name, genericWords(config)) ? { candidate, companyName: name } : null;
  }

  if (!candidate.url) return null;

  const page = await fetcher.getHtml(candidate.url);

  if (!page.ok) {
    // Not the site's fault, so not a finding.
    if (page.reason === "robots" || page.reason === "blocked-host") return null;
    // We can't read the site, so only keep it if the search result itself showed it fits.
    if (!snippetFits(candidate, config)) return null;

    const failedName = deriveCompanyName("", candidate.nameHint, candidate.host);
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

  if (!site.matchesIndustry || !site.matchesLocation) return null;

  const companyName = deriveCompanyName(site.siteName, site.title, candidate.host);
  if (isGenericName(companyName, genericWords(config))) return null;

  return {
    candidate,
    companyName,
    website: new URL(site.url).origin,
    site,
  };
}

function toPortalLead(
  lead: ScoredLead,
  summary: string,
  config: AgentConfig,
): PortalLead {
  const { audited } = lead;

  return {
    companyName: clip(audited.companyName, 200),
    website: audited.website ? clip(audited.website, 300) : undefined,
    industry: config.industryLabel,
    location: config.city,
    email: audited.site?.emails[0],
    phoneNumber: audited.site?.phones[0] ? clip(audited.site.phones[0], 30) : undefined,
    case: lead.case,
    score: lead.score,
    summary: clip(summary, 1000),
    evidence: lead.evidence.slice(0, 10).map((item) => ({
      finding: clip(item.finding, 500),
      ...(item.sourceUrl && item.sourceUrl.length <= 1000 ? { sourceUrl: item.sourceUrl } : {}),
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const configIndex = args.indexOf("--config");
  const configPath = configIndex >= 0 ? (args[configIndex + 1] ?? "agent.config.json") : "agent.config.json";

  const env = loadEnv();
  const config = loadConfig(configPath);
  const now = new Date();
  const runId = `agent-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;

  if (!dryRun && (!env.PORTAL_URL || !env.PORTAL_API_KEY)) {
    throw new Error("PORTAL_URL and PORTAL_API_KEY are required unless you run with --dry-run.");
  }

  const settings = llmSettings(env);
  const llm = settings ? new LlmClient(settings) : null;
  info(`Run ${runId}${dryRun ? " (dry run, nothing is sent)" : ""}`);
  info(`Looking for: ${config.industry} in ${config.city}`);
  info(llm ? `AI model: ${settings?.model}` : "AI model: not configured, using plain summaries and skipping reputation checks");

  const reputationBudget = llm ? config.reputationChecks : 0;
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
  const found = await discover(config, tavily, fetcher, now, reputationBudget);
  const fresh = found.filter((candidate) => !state.has(candidate.host));
  info(`  ${found.length} candidates, ${fresh.length} not seen before`);

  // 2. Look at each one
  info("\n2. Checking websites");
  const audits = await mapPool(fresh, 4, async (candidate) => {
    const audited = await auditCandidate(candidate, fetcher, config, now);
    state.mark(candidate.host);
    return audited;
  });
  const audited = audits.filter((item): item is Audited => item !== null);
  info(`  ${audited.length} fit the industry and area`);

  // 3. Reputation check for the most promising few
  const reputation = new Map<Audited, ReputationResult>();
  if (reputationBudget > 0) {
    info("\n3. Checking reputation");
    const ranked = audited
      .map((item) => ({ item, pre: scoreLead(item, null, now)?.score ?? 0 }))
      .filter((entry) => entry.pre > 0)
      .sort((a, b) => b.pre - a.pre)
      .slice(0, reputationBudget);

    for (const { item } of ranked) {
      if (tavily.searchesLeft === 0) break;
      const ownHost = item.website ? hostOf(item.website) : null;
      try {
        const result = await checkReputation(item.companyName, ownHost, config, tavily, llm);
        if (result) reputation.set(item, result);
      } catch (error) {
        warn(`Reputation check skipped for ${item.companyName}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // 4. Score and pick
  const scored = audited
    .map((item) => scoreLead(item, reputation.get(item) ?? null, now))
    .filter((lead): lead is ScoredLead => lead !== null && lead.score >= config.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxLeadsPerRun);

  info(`\n4. ${scored.length} leads at or above the minimum score of ${config.minScore}`);

  // 5. Write the notes
  let summaries: Awaited<ReturnType<typeof summarise>>;
  try {
    summaries = await summarise(scored, llm);
  } catch (error) {
    warn("Writing the notes with the AI model failed, using plain notes:", error instanceof Error ? error.message : error);
    summaries = await summarise(scored, null);
  }
  const leads = scored.map((lead) => toPortalLead(lead, summaries.get(lead) ?? "", config));

  mkdirSync(env.OUT_DIR, { recursive: true });
  const outFile = join(env.OUT_DIR, `${runId}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ runId, searchesUsed: tavily.searchesUsed, checked: audited.length, leads }, null, 2),
  );
  info(`  saved ${outFile}`);

  for (const lead of leads) {
    info(`  ${String(lead.score).padStart(3)}  ${lead.case.padEnd(18)} ${lead.companyName}`);
  }

  // 6. Send to the portal
  let failed = false;
  if (dryRun) {
    info("\nDry run: nothing sent to the portal.");
  } else if (leads.length === 0) {
    info("\nNothing to send.");
  } else {
    info("\n5. Sending to the portal");
    const portal = new PortalClient(env.PORTAL_URL as string, env.PORTAL_API_KEY as string);
    const report = await portal.send(leads, runId);

    info(`  added ${report.added}, skipped ${report.skipped.length}, failed ${report.failed.length}`);
    for (const item of report.skipped) info(`  skipped ${item.companyName}: ${item.reason}`);
    for (const item of report.failed) warn(`failed ${item.companyName}: ${item.error}`);
    failed = report.failed.length > 0;
  }

  // Only remember what we've seen once a real run has worked. A dry run leaves no trace.
  if (!failed && !dryRun) state.save();
  info(`\nDone. Searches used: ${tavily.searchesUsed}/${config.maxSearchesPerRun}.`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
