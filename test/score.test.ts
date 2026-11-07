import { describe, expect, it } from "vitest";
import { auditHtml } from "../src/audit.js";
import { scoreLead } from "../src/score.js";
import type { Audited, Candidate } from "../src/types.js";
import {
  LOVABLE_SHELL,
  MODERN_SITE,
  NEXT_STARTUP,
  OLD_BUT_VISIBLE,
  OLD_SITE,
  SPA_SHELL,
} from "./fixtures.js";

const now = new Date("2026-10-21T10:00:00Z");
const context = {
  industryKeywords: ["solar", "software"],
  locationKeywords: ["johannesburg", "pretoria"],
  now,
};

const audit = (html: string, url: string, name = "Example"): Audited => ({
  candidate: {
    host: new URL(url).hostname,
    url,
    nameHint: name,
    snippet: "",
    via: "test",
  },
  companyName: name,
  website: new URL(url).origin,
  site: auditHtml(html, url, context),
});

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  host: "example.co.za",
  url: "https://example.co.za/",
  nameHint: "Example",
  snippet: "",
  via: "test",
  ...overrides,
});

describe("scoreLead", () => {
  it("scores an old site high and calls it outdated", () => {
    const audited: Audited = {
      candidate: candidate(),
      companyName: "Sunbright Solar",
      website: "http://sunbright.co.za",
      site: auditHtml(OLD_SITE, "http://sunbright.co.za/", context),
    };

    const lead = scoreLead(audited, null, now);

    expect(lead.case).toBe("OutdatedWebsite");
    expect(lead.score).toBeGreaterThanOrEqual(80);
    expect(
      lead.evidence.every((item) => item.sourceUrl?.startsWith("http")),
    ).toBe(true);
  });

  it("lets an old site earn only a limited share of the score on age alone", () => {
    const lead = scoreLead(
      audit(OLD_BUT_VISIBLE, "http://sunbright.co.za/", "Sunbright"),
      null,
      now,
    );

    expect(lead.case).toBe("OutdatedWebsite");
    expect(lead.needPoints).toBe(45);
  });

  it("gives a healthy site no gap points, but still returns it", () => {
    const lead = scoreLead(
      audit(MODERN_SITE, "https://brightwave.co.za/", "Brightwave"),
      null,
      now,
    );

    expect(lead.score).toBe(0);
    expect(lead.case).toBe("Other");
  });

  it("calls a social-only company a no-website lead", () => {
    const audited: Audited = {
      candidate: candidate({
        url: undefined,
        socialOnly: { url: "https://facebook.com/xyz", platform: "Facebook" },
      }),
      companyName: "XYZ Solar",
    };

    const lead = scoreLead(audited, null, now);

    expect(lead.case).toBe("NoWebsite");
    expect(lead.evidence[0]?.sourceUrl).toBe("https://facebook.com/xyz");
  });

  it("lets a reputation problem on a fine site become a PR lead", () => {
    const site = auditHtml(MODERN_SITE, "https://brightwave.co.za/", context);
    const audited: Audited = {
      candidate: candidate(),
      companyName: "Brightwave",
      website: "https://brightwave.co.za",
      site,
    };

    const lead = scoreLead(
      audited,
      {
        negative: true,
        evidence: [
          { finding: "Complaints", sourceUrl: "https://example.com/a" },
        ],
      },
      now,
    );

    expect(lead.case).toBe("StrugglingPr");
    expect(lead.score).toBe(35);
  });

  it("never goes above 100", () => {
    const site = auditHtml(OLD_SITE, "http://sunbright.co.za/", context);
    const audited: Audited = {
      candidate: candidate(),
      companyName: "S",
      website: "http://s.co.za",
      site,
    };

    const lead = scoreLead(audited, { negative: true, evidence: [] }, now);

    expect(lead.score).toBeLessThanOrEqual(100);
  });
});

describe("modern sites", () => {
  it("does not punish a JavaScript-drawn page for what it can't show", () => {
    const lead = scoreLead(
      audit(SPA_SHELL, "https://acme.example/", "Acme"),
      null,
      now,
    );
    const findings = lead.evidence.map((item) => item.finding).join(" | ");

    expect(findings).not.toMatch(
      /very little text|social media account|blog|case studies|share image/i,
    );
    expect(findings).toMatch(/template/);
  });

  it("calls an AI-built page with builder defaults a low-visibility lead", () => {
    const lead = scoreLead(
      audit(LOVABLE_SHELL, "https://nimbus.lovable.app/", "Nimbus Labs"),
      null,
      now,
    );

    expect(lead.case).toBe("LowVisibility");
    expect(lead.fitPoints).toBeGreaterThan(0);
    expect(lead.evidence.map((item) => item.finding).join(" ")).toMatch(
      /starter address/,
    );
  });

  it("finds gaps on a good-looking server-rendered site", () => {
    const lead = scoreLead(
      audit(NEXT_STARTUP, "https://nimbus.example/", "Nimbus Labs"),
      null,
      now,
    );
    const findings = lead.evidence.map((item) => item.finding).join(" | ");

    expect(lead.case).toBe("LowVisibility");
    expect(findings).toMatch(/blog/);
    expect(findings).toMatch(/case studies/);
    expect(lead.fitPoints).toBeGreaterThan(0);
    expect(lead.score).toBe(lead.needPoints + lead.fitPoints);
  });

  it("uses search results to see a LinkedIn page the site didn't link to", () => {
    const audited = audit(SPA_SHELL, "https://acme.example/", "Acme");
    const withLinkedIn = scoreLead(audited, null, now, {
      profiles: [
        {
          platform: "LinkedIn",
          url: "https://www.linkedin.com/company/acme",
          followers: 120,
        },
      ],
    });
    const nothingFound = scoreLead(audited, null, now, { profiles: [] });

    expect(withLinkedIn.evidence.map((item) => item.finding).join(" ")).toMatch(
      /120 followers/,
    );
    expect(nothingFound.evidence.map((item) => item.finding).join(" ")).toMatch(
      /Couldn't find any social/,
    );
  });
});
