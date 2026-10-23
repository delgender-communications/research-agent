import { describe, expect, it } from "vitest";
import { cleanSocialTitle, containsKeyword, isBusinessSocialPage, isGenericName, nameKey, registrableHost } from "../src/util.js";
import { isPrivateIp, robotsDisallowsAll } from "../src/web/safeFetch.js";

describe("isPrivateIp", () => {
  it("blocks private and local addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "41.0.0.1", "172.32.0.1"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("robotsDisallowsAll", () => {
  it("detects a full-site block for everyone", () => {
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /")).toBe(true);
  });

  it("allows normal robots files", () => {
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /admin/")).toBe(false);
    expect(robotsDisallowsAll("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow:")).toBe(false);
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /\nAllow: /public")).toBe(false);
  });
});

describe("helpers", () => {
  it("matches keywords as whole words", () => {
    expect(containsKeyword("We install solar panels", ["solar"])).toBe(true);
    expect(containsKeyword("Insolar Inc", ["solar"])).toBe(false);
    expect(containsKeyword("a PV system", ["pv"])).toBe(true);
  });

  it("builds the same name key as the portal", () => {
    expect(nameKey("The Sunbright Solar (Pty) Ltd")).toBe("sunbrightsolar");
  });

  it("finds the company part of a web address", () => {
    expect(registrableHost("www.shop.example.co.za")).toBe("example.co.za");
    expect(registrableHost("blog.example.com")).toBe("example.com");
  });
});

describe("cleanSocialTitle", () => {
  it("strips the platform name and keeps the business name", () => {
    expect(cleanSocialTitle("Solar Pros Joburg | Facebook")).toBe("Solar Pros Joburg");
    expect(cleanSocialTitle("Solar Pros - Home | Facebook")).toBe("Solar Pros");
    expect(cleanSocialTitle("I Solar Solutions | Roodepoort | Facebook")).toBe("I Solar Solutions");
  });
});

const ignore = ["solar", "johannesburg", "roodepoort", "midrand", "solar installation"];

describe("isGenericName", () => {
  it("rejects search phrases and page headings", () => {
    for (const name of [
      "reputable solar installer in johannesburg?",
      "Solar panel installation quotes in Midrand",
      "Solar Installation Roodepoort",
      "Solar installers in Midrand",
      "Solar Panel Installers",
      "Best solar companies",
    ]) {
      expect(isGenericName(name, ignore)).toBe(true);
    }
  });

  it("keeps real company names", () => {
    for (const name of ["JM Solar Solutions", "Sinetech", "SolarZA", "Sunworx Solar", "Full Solar Systems", "I Solar Solutions"]) {
      expect(isGenericName(name, ignore)).toBe(false);
    }
  });
});

describe("isBusinessSocialPage", () => {
  it("accepts business pages and rejects posts and groups", () => {
    expect(isBusinessSocialPage("https://www.facebook.com/sunbrightsolar")).toBe(true);
    expect(isBusinessSocialPage("https://www.instagram.com/sunbright/")).toBe(true);
    expect(isBusinessSocialPage("https://www.facebook.com/groups/joburgsolar/posts/123")).toBe(false);
    expect(isBusinessSocialPage("https://www.facebook.com/someone/posts/pfbid0abc")).toBe(false);
    expect(isBusinessSocialPage("https://www.instagram.com/p/Cabc123/")).toBe(false);
    expect(isBusinessSocialPage("https://www.facebook.com/reel/123")).toBe(false);
  });
});
