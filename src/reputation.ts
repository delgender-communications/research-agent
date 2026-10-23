import { z } from "zod";
import type { AgentConfig } from "./config.js";
import { extractJson, type LlmClient } from "./llm.js";
import type { TavilyClient } from "./search/tavily.js";
import type { Evidence, ReputationResult, SearchHit } from "./types.js";
import { clip, nameKey, registrableHost } from "./util.js";

const VerdictSchema = z.object({
  negative: z.boolean(),
  reason: z.string().default(""),
  evidenceIds: z.array(z.number().int()).default([]),
});

const SYSTEM = `You help a PR consultancy spot companies with reputation problems.
You are given numbered web search results about one company.
Decide whether they show a REAL reputation problem for THIS company: repeated customer complaints, scam warnings, legal or regulatory trouble, or clearly negative press.
Ignore results that are about a different company with a similar name, that are unclear, or that are just ordinary reviews with a few mixed comments.
Only use what is in the results. Do not guess.
Reply with JSON only, in this shape: {"negative": true or false, "reason": "one plain sentence", "evidenceIds": [numbers of the results that show it]}`;

function mentionsCompany(hit: SearchHit, key: string): boolean {
  const flat = `${hit.title} ${hit.content}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return key.length >= 4 && flat.includes(key);
}

// One search plus one model call. Returns null when the check couldn't run
// (no model configured, no searches left, model failed), which is different
// from "ran and found nothing".
export async function checkReputation(
  companyName: string,
  ownHost: string | null,
  config: AgentConfig,
  tavily: TavilyClient,
  llm: LlmClient | null,
): Promise<ReputationResult | null> {
  if (!llm || tavily.searchesLeft === 0) return null;

  const key = nameKey(companyName);
  const own = ownHost ? registrableHost(ownHost) : null;

  const hits = (
    await tavily.search(`"${companyName}" ${config.city} reviews complaints`)
  )
    .filter((hit) => mentionsCompany(hit, key))
    .filter((hit) => {
      try {
        return !own || registrableHost(new URL(hit.url).hostname) !== own;
      } catch {
        return false;
      }
    })
    .slice(0, 6);

  if (hits.length === 0) return { negative: false, evidence: [] };

  const listing = hits
    .map(
      (hit, index) =>
        `[${index + 1}] ${clip(hit.title, 120)}\n${hit.url}\n${clip(hit.content, 450)}`,
    )
    .join("\n\n");

  const reply = await llm.complete(
    SYSTEM,
    `Company: ${companyName} (${config.city})\n\nResults:\n${listing}`,
  );
  if (!reply) return null;

  const parsed = VerdictSchema.safeParse(extractJson(reply));
  if (!parsed.success) return null;

  const verdict = parsed.data;
  if (!verdict.negative) return { negative: false, evidence: [] };

  // Only ever link to results we actually gave the model.
  const cited = verdict.evidenceIds
    .map((id) => hits[id - 1])
    .filter((hit): hit is SearchHit => Boolean(hit));

  if (cited.length === 0) return { negative: false, evidence: [] };

  const evidence: Evidence[] = [
    {
      finding: clip(
        `Possible reputation problem: ${verdict.reason || "negative coverage found"} (unverified, check the sources).`,
        400,
      ),
      sourceUrl: cited[0]?.url,
    },
    ...cited
      .slice(0, 2)
      .map((hit) => ({ finding: clip(hit.title, 200), sourceUrl: hit.url })),
  ];

  return { negative: true, evidence };
}
