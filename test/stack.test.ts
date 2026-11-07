import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { auditHtml } from "../src/audit.js";
import {
  findTemplateDefaults,
  isModernStack,
  isPlaceholderTitle,
  stackLabel,
  starterHosting,
} from "../src/stack.js";
import {
  LOVABLE_SHELL,
  MODERN_SITE,
  NEXT_STARTUP,
  OLD_SITE,
  SPA_SHELL,
} from "./fixtures.js";

const context = {
  industryKeywords: ["software"],
  locationKeywords: ["pretoria", "centurion"],
  now: new Date("2026-11-07T10:00:00Z"),
};

describe("stack detection", () => {
  it("sees a Vite + React app as an empty shell", () => {
    const site = auditHtml(SPA_SHELL, "https://acme.example/", context);

    expect(site.stack.frameworks).toEqual(["React (Vite)"]);
    expect(site.stack.scriptRendered).toBe(true);
    expect(stackLabel(site.stack)).toBe("React (Vite) · JS-rendered");
    expect(isModernStack(site.stack)).toBe(true);
  });

  it("names Lovable when it leaves a clear marker", () => {
    const site = auditHtml(LOVABLE_SHELL, "https://nimbus.example/", context);

    expect(site.stack.builder).toBe("Lovable");
    expect(site.stack.scriptRendered).toBe(true);
  });

  it("does not call a server-rendered Next.js site an empty shell", () => {
    const site = auditHtml(NEXT_STARTUP, "https://nimbus.example/", context);

    expect(site.stack.frameworks).toEqual(["Next.js"]);
    expect(site.stack.scriptRendered).toBe(false);
    expect(site.wordCount).toBeGreaterThan(150);
  });

  it("does not call an old brochure site JavaScript-rendered", () => {
    const site = auditHtml(OLD_SITE, "http://sunbright.co.za/", context);

    expect(site.stack.scriptRendered).toBe(false);
    expect(site.stack.frameworks).toEqual([]);
    expect(isModernStack(site.stack)).toBe(false);
  });

  it("leaves an ordinary healthy site without a stack label", () => {
    const site = auditHtml(MODERN_SITE, "https://brightwave.co.za/", context);

    expect(site.stack.scriptRendered).toBe(false);
    expect(stackLabel(site.stack)).toBeUndefined();
  });
});

describe("starter addresses", () => {
  it("spots free hosting addresses and their subdomains", () => {
    expect(starterHosting("nimbus.vercel.app")).toBe("Vercel");
    expect(starterHosting("nimbus.lovable.app")).toBe("Lovable");
    expect(starterHosting("nimbus.co.za")).toBeNull();
    expect(starterHosting("notvercel.app.example.com")).toBeNull();
  });

  it("marks the site as on a starter domain", () => {
    const site = auditHtml(NEXT_STARTUP, "https://nimbus.vercel.app/", context);
    expect(site.stack.starterDomain).toBe(true);
    expect(stackLabel(site.stack)).toBe("Next.js · Vercel");
  });
});

describe("template leftovers", () => {
  it("recognises template titles but not real ones", () => {
    for (const title of [
      "Vite + React + TS",
      "React App",
      "Create Next App",
      "Lovable Generated Project",
      "Vite App",
    ]) {
      expect(isPlaceholderTitle(title)).toBe(true);
    }
    for (const title of [
      "Nimbus Labs | AI software",
      "Vitesse Logistics",
      "Reactive Systems",
    ]) {
      expect(isPlaceholderTitle(title)).toBe(false);
    }
  });

  it("lists what a builder left behind", () => {
    const $ = cheerio.load(LOVABLE_SHELL);
    const found = findTemplateDefaults(
      $,
      "Nimbus Labs",
      "Lovable Generated Project",
    );

    expect(found.join(" | ")).toContain("description");
    expect(found.join(" | ")).toContain("share image");
    expect(found.join(" | ")).toContain("Lovable");
  });

  it("flags the framework's default favicon", () => {
    const site = auditHtml(SPA_SHELL, "https://acme.example/", context);
    expect(site.templateDefaults.join(" ")).toContain("favicon");
    expect(site.placeholderTitle).toBe(true);
  });
});

describe("modern sites that hide things from a plain fetch", () => {
  it("reads the place and the social page from structured data in the head", () => {
    const site = auditHtml(LOVABLE_SHELL, "https://nimbus.example/", context);

    expect(site.matchesLocation).toBe(true);
    expect(site.socialLinks.map((link) => link.platform).sort()).toEqual([
      "LinkedIn",
      "X",
    ]);
  });

  it("only treats 'coming soon' as under construction when it is most of the page", () => {
    const longStartup = `<html><body><p>${"We build software in Pretoria. ".repeat(40)}</p><p>Mobile app coming soon.</p></body></html>`;
    const stub = "<html><body><h1>Coming soon</h1></body></html>";

    expect(
      auditHtml(longStartup, "https://a.example/", context).underConstruction,
    ).toBe(false);
    expect(
      auditHtml(stub, "https://b.example/", context).underConstruction,
    ).toBe(true);
  });

  it("finds blog, case study and careers links", () => {
    const withLinks = auditHtml(
      MODERN_SITE,
      "https://brightwave.co.za/",
      context,
    );
    const without = auditHtml(NEXT_STARTUP, "https://nimbus.example/", context);

    expect(withLinks.hasNewsOrBlog).toBe(true);
    expect(withLinks.hasCaseStudies).toBe(true);
    expect(without.hasNewsOrBlog).toBe(false);
    expect(without.hasCaseStudies).toBe(false);
    expect(without.hasCareers).toBe(true);
  });
});
