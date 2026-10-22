import { z } from "zod";
import { extractJson, type LlmClient } from "./llm.js";
import type { LeadCase, ScoredLead } from "./types.js";
import { clip, info } from "./util.js";

const CASE_PHRASE: Record<LeadCase, string> = {
  StrugglingPr: "a possible reputation problem",
  WeakSocialPresence: "a weak social media presence",
  NoWebsite: "no website of their own",
  OutdatedWebsite: "an outdated or broken website",
  Other: "something worth a look",
};

// Plain summary built from the findings. Used whenever the model isn't available.
export function fallbackSummary(lead: ScoredLead): string {
  const [first, second] = lead.evidence;
  return clip(
    `Looks like ${CASE_PHRASE[lead.case]}. ${first?.finding ?? ""} ${second?.finding ?? ""}`,
    600,
  );
}

const ReplySchema = z.object({
  summaries: z.array(z.object({ id: z.number().int(), summary: z.string() })),
});

const SYSTEM = `You write short notes for a PR and brand consultancy in Johannesburg that is deciding which companies to approach.
For each company you get numbered facts found by an automated check. Write 1 or 2 plain sentences per company on why we might be able to help them.
Use only the facts given. Do not invent anything, do not mention scores, and do not use hype.
Reply with JSON only, in this shape: {"summaries": [{"id": 1, "summary": "..."}]}`;

const BATCH_SIZE = 8;

export async function summarise(leads: ScoredLead[], llm: LlmClient | null): Promise<Map<ScoredLead, string>> {
  const result = new Map<ScoredLead, string>();
  for (const lead of leads) result.set(lead, fallbackSummary(lead));

  if (!llm) return result;

  for (let start = 0; start < leads.length; start += BATCH_SIZE) {
    const batch = leads.slice(start, start + BATCH_SIZE);

    const prompt = batch
      .map((lead, index) => {
        const facts = lead.evidence.map((item) => `- ${item.finding}`).join("\n");
        return `${index + 1}. ${lead.audited.companyName} (main issue: ${CASE_PHRASE[lead.case]})\n${facts}`;
      })
      .join("\n\n");

    const reply = await llm.complete(SYSTEM, prompt);
    if (!reply) continue;

    const parsed = ReplySchema.safeParse(extractJson(reply));
    if (!parsed.success) {
      info("  Couldn't read the model's summaries for one batch, using plain ones.");
      continue;
    }

    for (const item of parsed.data.summaries) {
      const lead = batch[item.id - 1];
      const text = clip(item.summary, 600);
      if (lead && text.length > 10) result.set(lead, text);
    }
  }

  return result;
}
