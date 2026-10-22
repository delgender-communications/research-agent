import { describe, expect, it } from "vitest";
import { auditHtml } from "../src/audit.js";
import { scoreLead } from "../src/score.js";
import type { Audited, Candidate } from "../src/types.js";
import { MODERN_SITE, OLD_SITE } from "./fixtures.js";

const now = new Date("2026-10-21T10:00:00Z");
const context = {
  industryKeywords: ["solar"],
  locationKeywords: ["johannesburg"],
  now,
};

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

    expect(lead?.case).toBe("OutdatedWebsite");
    expect(lead?.score).toBeGreaterThanOrEqual(80);
    expect(lead?.evidence.every((item) => item.sourceUrl?.startsWith("http"))).toBe(true);
  });

  it("finds nothing to report on a healthy site", () => {
    const audited: Audited = {
      candidate: candidate(),
      companyName: "Brightwave",
      website: "https://brightwave.co.za",
      site: auditHtml(MODERN_SITE, "https://brightwave.co.za/", context),
    };

    expect(scoreLead(audited, null, now)).toBeNull();
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

    expect(lead?.case).toBe("NoWebsite");
    expect(lead?.evidence[0]?.sourceUrl).toBe("https://facebook.com/xyz");
  });

  it("lets a reputation problem on a fine site become a PR lead", () => {
    const site = auditHtml(MODERN_SITE, "https://brightwave.co.za/", context);
    const audited: Audited = { candidate: candidate(), companyName: "Brightwave", website: "https://brightwave.co.za", site };

    const lead = scoreLead(
      audited,
      { negative: true, evidence: [{ finding: "Complaints", sourceUrl: "https://example.com/a" }] },
      now,
    );

    expect(lead?.case).toBe("StrugglingPr");
    expect(lead?.score).toBe(35);
  });

  it("never goes above 100", () => {
    const site = auditHtml(OLD_SITE, "http://sunbright.co.za/", context);
    const audited: Audited = { candidate: candidate(), companyName: "S", website: "http://s.co.za", site };

    const lead = scoreLead(audited, { negative: true, evidence: [] }, now);

    expect(lead?.score).toBeLessThanOrEqual(100);
  });
});
