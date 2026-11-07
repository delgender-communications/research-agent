import { stackLabel } from "./stack.js";
import type { ScoredLead, Triaged } from "./types.js";
import { clip } from "./util.js";

export interface TriageOptions {
  // Score needed to go straight to the Recommended list.
  minScore: number;
  // Lowest score still worth a human look. 0 keeps every confirmed company.
  researchMinScore: number;
  maxLeads: number;
  maxResearch: number;
  city: string;
}

// Why a person should look at this company, in plain words. Empty when the agent
// is confident enough that nothing needs saying.
export function researchReasons(
  lead: ScoredLead,
  options: TriageOptions,
): string[] {
  const { audited } = lead;
  const site = audited.site;
  const reasons: string[] = [];

  if (site?.stack.scriptRendered) {
    const label = stackLabel(site.stack);
    reasons.push(
      `The homepage is drawn by JavaScript${label ? ` (${label})` : ""}, so the agent only saw an empty page shell. ` +
        "Its content, blog and social links weren't checked.",
    );
  } else if (audited.fit?.viaSnippet) {
    reasons.push(
      "The homepage couldn't be read properly, so the industry and area were judged from search result text.",
    );
  }

  if (audited.fit && !audited.fit.location) {
    reasons.push(
      `The site doesn't say where they're based. Confirm they're in ${options.city}.`,
    );
  }

  if (
    site &&
    site.stack.scriptRendered &&
    lead.evidence.every(
      (item) => !/social|LinkedIn|Facebook|Instagram/i.test(item.finding),
    )
  ) {
    reasons.push(
      "Check whether they have LinkedIn, Instagram or other accounts, and how active they are.",
    );
  }

  if (lead.score < options.minScore) {
    reasons.push(
      lead.needPoints === 0
        ? "No clear gaps from the homepage, but it's a confirmed match. Check LinkedIn activity, recent news and how they describe themselves."
        : "Only small gaps from the homepage. Check LinkedIn activity, recent news and how they describe themselves before deciding.",
    );
  }

  return reasons;
}

// Splits scored companies into Recommended and Needs research.
//
//  - Recommended: scored high enough and the place is confirmed.
//  - Needs research: everything else that still fits the industry. These were
//    dropped before, which is how modern sites and quiet companies got lost.
//  - A strong lead that doesn't fit under this run's limit moves to research
//    instead of being thrown away, because the agent won't look at it again.
export function triage(
  scored: ScoredLead[],
  options: TriageOptions,
): { recommended: Triaged[]; research: Triaged[] } {
  const byScore = [...scored].sort((a, b) => b.score - a.score);

  const strong = byScore.filter(
    (lead) =>
      lead.score >= options.minScore && (lead.audited.fit?.location ?? true),
  );
  const rest = byScore.filter((lead) => !strong.includes(lead));

  const recommended: Triaged[] = strong
    .slice(0, options.maxLeads)
    .map((lead) => ({
      lead,
      needsResearch: false,
      researchReasons: [],
    }));

  const overflow = strong.slice(options.maxLeads).map((lead) => ({
    lead,
    needsResearch: true,
    researchReasons: [
      `Scored ${lead.score}, which is strong, but this run was limited to ${options.maxLeads} recommended leads.`,
      ...researchReasons(lead, { ...options, minScore: 0 }),
    ],
  }));

  const others = rest
    .filter((lead) => lead.score >= options.researchMinScore)
    .map((lead) => ({
      lead,
      needsResearch: true,
      researchReasons: researchReasons(lead, options),
    }));

  const research = [...overflow, ...others].slice(0, options.maxResearch);
  return { recommended, research };
}

export function reasonText(item: Triaged): string | undefined {
  return item.researchReasons.length > 0
    ? clip(item.researchReasons.join(" "), 1000)
    : undefined;
}
