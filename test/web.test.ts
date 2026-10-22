import { describe, expect, it } from "vitest";
import { containsKeyword, nameKey, registrableHost } from "../src/util.js";
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
  it("strips the platform name from page titles", async () => {
    const { cleanSocialTitle } = await import("../src/util.js");
    expect(cleanSocialTitle("Solar Pros Joburg | Facebook")).toBe("Solar Pros Joburg");
    expect(cleanSocialTitle("Solar Pros - Home | Facebook")).toBe("Solar Pros");
  });
});
