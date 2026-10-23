import { describe, expect, it } from "vitest";
import {
  auditHtml,
  deriveCompanyName,
  findCopyrightYear,
} from "../src/audit.js";
import { MODERN_SITE, OLD_SITE } from "./fixtures.js";

const context = {
  industryKeywords: ["solar", "pv", "inverter"],
  locationKeywords: ["johannesburg", "sandton"],
  now: new Date("2026-10-21T10:00:00Z"),
};

describe("auditHtml", () => {
  it("spots an old, thin site", () => {
    const site = auditHtml(OLD_SITE, "http://sunbright.co.za/", context);

    expect(site.https).toBe(false);
    expect(site.hasViewport).toBe(false);
    expect(site.copyrightYear).toBe(2016);
    expect(site.legacyMarkup).toEqual(
      expect.arrayContaining(["font tags", "center tags"]),
    );
    expect(site.socialLinks).toHaveLength(0);
    expect(site.matchesIndustry).toBe(true);
    expect(site.matchesLocation).toBe(true);
  });

  it("keeps only business contacts on the company's own domain", () => {
    const site = auditHtml(OLD_SITE, "http://sunbright.co.za/", context);

    expect(site.emails).toEqual(["info@sunbright.co.za"]);
    expect(site.phones[0]).toContain("011 555 0123");
  });

  it("reads a healthy site and ignores share buttons", () => {
    const site = auditHtml(MODERN_SITE, "https://brightwave.co.za/", context);

    expect(site.https).toBe(true);
    expect(site.hasViewport).toBe(true);
    expect(site.legacyMarkup).toHaveLength(0);
    expect(site.socialLinks.map((link) => link.platform).sort()).toEqual([
      "Facebook",
      "Instagram",
    ]);
    expect(site.siteName).toBe("Brightwave Energy");
  });

  it("does not match unrelated sites", () => {
    const site = auditHtml(
      "<html><head><title>Bakery</title></head><body>Bread in Cape Town</body></html>",
      "https://bakery.example/",
      context,
    );

    expect(site.matchesIndustry).toBe(false);
    expect(site.matchesLocation).toBe(false);
  });
});

describe("findCopyrightYear", () => {
  const now = new Date("2026-10-21T00:00:00Z");

  it("takes the latest year in a range", () => {
    expect(findCopyrightYear("© 2012 - 2019 Acme", now)).toBe(2019);
  });

  it("ignores impossible years", () => {
    expect(findCopyrightYear("Copyright 1850 Acme", now)).toBeNull();
    expect(findCopyrightYear("© 2099 Acme", now)).toBeNull();
  });
});

describe("deriveCompanyName", () => {
  it("prefers the site name when there is one", () => {
    expect(
      deriveCompanyName("Brightwave Energy", "Whatever", "brightwave.co.za"),
    ).toBe("Brightwave Energy");
  });

  it("picks the title part that matches the web address", () => {
    expect(
      deriveCompanyName(
        "",
        "Home | Sunbright Solar - Johannesburg",
        "sunbright.co.za",
      ),
    ).toBe("Sunbright Solar");
  });

  it("falls back to the web address", () => {
    expect(deriveCompanyName("", "", "sunbright.co.za")).toBe("Sunbright");
  });
});
