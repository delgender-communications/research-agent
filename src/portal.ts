import { z } from "zod";
import type { PortalLead } from "./types.js";
import { info, warn } from "./util.js";

const ResultSchema = z.object({
  added: z.number().int(),
  skipped: z.array(z.object({ companyName: z.string(), reason: z.string() })).default([]),
});

export interface DeliveryReport {
  added: number;
  skipped: { companyName: string; reason: string }[];
  failed: { companyName: string; error: string }[];
}

const BATCH_SIZE = 50;

export class PortalClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async send(leads: PortalLead[], runId: string): Promise<DeliveryReport> {
    const report: DeliveryReport = { added: 0, skipped: [], failed: [] };

    for (let start = 0; start < leads.length; start += BATCH_SIZE) {
      const batch = leads.slice(start, start + BATCH_SIZE);
      const outcome = await this.post(batch, runId);

      if (outcome.ok) {
        report.added += outcome.data.added;
        report.skipped.push(...outcome.data.skipped);
        continue;
      }

      // A bad request means the portal rejected something in the batch. Send the
      // leads one by one so one bad lead can't block the rest.
      if (outcome.status === 400 && batch.length > 1) {
        warn("The portal rejected a batch. Sending those leads one at a time.");
        for (const lead of batch) {
          const single = await this.post([lead], runId);
          if (single.ok) {
            report.added += single.data.added;
            report.skipped.push(...single.data.skipped);
          } else {
            report.failed.push({ companyName: lead.companyName, error: single.error });
          }
        }
        continue;
      }

      for (const lead of batch) {
        report.failed.push({ companyName: lead.companyName, error: outcome.error });
      }
    }

    return report;
  }

  private async post(
    leads: PortalLead[],
    runId: string,
  ): Promise<
    | { ok: true; data: z.infer<typeof ResultSchema> }
    | { ok: false; status: number; error: string }
  > {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/v1/research-agent/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": this.apiKey },
        body: JSON.stringify({ runId, leads }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : "network error" };
    }

    if (response.status === 401) {
      return { ok: false, status: 401, error: "The portal rejected the API key (401). Check PORTAL_API_KEY." };
    }

    if (response.status === 503) {
      return { ok: false, status: 503, error: "The portal says the research agent isn't set up (503). Set ResearchAgent__ApiKey on the server." };
    }

    try {
      if (!response.ok) {
        const body = (await response.text()).slice(0, 400);
        return { ok: false, status: response.status, error: `Portal answered ${response.status}: ${body}` };
      }

      const parsed = ResultSchema.safeParse(await response.json());
      if (parsed.success) {
        info(`  portal: ${parsed.data.added} added, ${parsed.data.skipped.length} skipped`);
        return { ok: true, data: parsed.data };
      }
    } catch (error) {
      return { ok: false, status: response.status, error: error instanceof Error ? error.message : "couldn't read the portal's reply" };
    }

    return { ok: false, status: response.status, error: "The portal's reply wasn't in the expected shape." };
  }
}
