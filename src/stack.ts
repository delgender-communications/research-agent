import type * as cheerio from "cheerio";
import type { SiteStack } from "./types.js";

// Free starter addresses. A company still on one of these has not set up its own
// domain yet, which is common for newer startups and AI-built sites.
const STARTER_HOSTS: Record<string, string> = {
  "vercel.app": "Vercel",
  "netlify.app": "Netlify",
  "pages.dev": "Cloudflare Pages",
  "lovable.app": "Lovable",
  "lovableproject.com": "Lovable",
  "bolt.host": "Bolt",
  "framer.website": "Framer",
  "framer.app": "Framer",
  "webflow.io": "Webflow",
  "github.io": "GitHub Pages",
  "onrender.com": "Render",
  "replit.app": "Replit",
  "repl.co": "Replit",
  "web.app": "Firebase",
  "firebaseapp.com": "Firebase",
  "fly.dev": "Fly.io",
  "herokuapp.com": "Heroku",
  "wixsite.com": "Wix",
  "carrd.co": "Carrd",
  "godaddysites.com": "GoDaddy",
  "weebly.com": "Weebly",
  "blogspot.com": "Blogger",
  "my.canva.site": "Canva",
};

export function starterHosting(host: string): string | null {
  const lower = host.toLowerCase();
  for (const [domain, label] of Object.entries(STARTER_HOSTS)) {
    if (lower === domain || lower.endsWith("." + domain)) return label;
  }
  return null;
}

// Frameworks, found from the markers they leave in the HTML. Order matters: the
// first matches win when two overlap (a Next.js site also contains React).
function detectFrameworks(html: string, $: cheerio.CheerioAPI): string[] {
  const lower = html.toLowerCase();
  const found: string[] = [];

  const scripts = $("script[src]")
    .map((_, element) => $(element).attr("src") ?? "")
    .get()
    .join(" ")
    .toLowerCase();

  if (
    lower.includes("/_next/") ||
    lower.includes("__next_data__") ||
    $("#__next").length > 0
  ) {
    found.push("Next.js");
  } else if (lower.includes("/_nuxt/") || lower.includes("__nuxt")) {
    found.push("Nuxt");
  } else if (lower.includes("___gatsby")) {
    found.push("Gatsby");
  } else if (lower.includes("__remixcontext")) {
    found.push("Remix");
  } else if (
    lower.includes("astro-island") ||
    lower.includes("/_astro/") ||
    /<meta[^>]+generator[^>]+astro/i.test(html)
  ) {
    found.push("Astro");
  } else if (
    lower.includes("/_app/immutable/") ||
    lower.includes("data-sveltekit")
  ) {
    found.push("SvelteKit");
  } else if (lower.includes("ng-version=") || $("app-root").length > 0) {
    found.push("Angular");
  } else if (/\/static\/js\/main\.[a-z0-9]+\.js/.test(scripts)) {
    found.push("React");
  } else if (
    $('script[type="module"][src]').length > 0 &&
    /\/assets\/index-[\w-]{6,}\.js/.test(scripts)
  ) {
    // The default Vite build. React apps mount on #root, Vue apps on #app.
    if ($("#root").length > 0) found.push("React (Vite)");
    else if ($("#app").length > 0) found.push("Vue (Vite)");
    else found.push("Vite");
  } else if (
    lower.includes("data-reactroot") ||
    /(^|[/.-])react(\.|-|\/)/.test(scripts)
  ) {
    found.push("React");
  } else if (/(^|[/.-])vue(\.|-|\/)/.test(scripts)) {
    found.push("Vue");
  }

  return found;
}

// Site builders and AI app builders. Only named when they leave a clear marker.
function detectBuilder(html: string): string | null {
  const lower = html.toLowerCase();

  if (
    /name=["']author["'][^>]+content=["']lovable|lovable\.(dev|app)|gptengineer/.test(
      lower,
    )
  )
    return "Lovable";
  if (lower.includes("bolt.new") || lower.includes("bolt.host")) return "Bolt";
  if (lower.includes("v0.dev")) return "v0";
  if (lower.includes("data-wf-site") || lower.includes("webflow.com"))
    return "Webflow";
  if (
    lower.includes("framerusercontent.com") ||
    /<meta[^>]+generator[^>]+framer/i.test(html)
  )
    return "Framer";
  if (
    lower.includes("wixstatic.com") ||
    /<meta[^>]+generator[^>]+wix/i.test(html)
  )
    return "Wix";
  if (
    lower.includes("squarespace.com") ||
    lower.includes("static1.squarespace")
  )
    return "Squarespace";
  if (lower.includes("/wp-content/") || lower.includes("/wp-includes/"))
    return "WordPress";
  if (lower.includes("cdn.shopify.com")) return "Shopify";
  return null;
}

// Below this many words the page is thin enough that an empty-shell check is worth making.
const SHELL_WORD_LIMIT = 150;

export function detectStack(
  html: string,
  $: cheerio.CheerioAPI,
  host: string,
  wordCount: number,
): SiteStack {
  const frameworks = detectFrameworks(html, $);
  const builder = detectBuilder(html);
  const hosting = starterHosting(host);

  const root = $("#root, #app, #__next, #__nuxt, #svelte, app-root").first();
  const rootText =
    root.length > 0 ? root.text().replace(/\s+/g, " ").trim().length : -1;
  const noscriptHint =
    /enable javascript|requires javascript|javascript is required|turn on javascript/i.test(
      $("noscript").text(),
    );
  const hasModuleBundle = $('script[type="module"][src]').length > 0;

  const emptyShell =
    noscriptHint ||
    (root.length > 0 && rootText < 200) ||
    (hasModuleBundle && frameworks.length > 0);

  return {
    frameworks,
    builder,
    hosting,
    scriptRendered: wordCount < SHELL_WORD_LIMIT && emptyShell,
    starterDomain: hosting !== null,
  };
}

// A short label for the portal, such as "Next.js · Vercel · JS-rendered".
export function stackLabel(stack: SiteStack): string | undefined {
  const parts: string[] = [];
  if (stack.builder) parts.push(stack.builder);
  for (const framework of stack.frameworks) {
    if (!parts.includes(framework)) parts.push(framework);
  }
  if (stack.hosting && !parts.includes(stack.hosting))
    parts.push(stack.hosting);
  if (stack.scriptRendered) parts.push("JS-rendered");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// Frameworks that mark a newer, tech-led site (as opposed to a template brochure site).
const MODERN = [
  "Next.js",
  "Nuxt",
  "Gatsby",
  "Remix",
  "Astro",
  "SvelteKit",
  "React",
  "React (Vite)",
  "Vue",
  "Vue (Vite)",
  "Vite",
  "Angular",
];

export function isModernStack(stack: SiteStack): boolean {
  return (
    stack.frameworks.some((name) => MODERN.includes(name)) ||
    stack.builder === "Lovable" ||
    stack.builder === "Bolt" ||
    stack.builder === "v0"
  );
}

const PLACEHOLDER_TITLE =
  /^(?:vite(?:\s*\+\s*(?:react|vue|svelte|preact))?(?:\s*\+\s*ts)?(?:\s*app)?|react app|create next app|next\.?js app|vue app|lovable(?:\s+(?:generated project|app))?|untitled(?:\s+document)?|my app|new project|bolt app|v0 app|sveltekit app|astro|document|localhost)$/i;

const PLACEHOLDER_DESCRIPTION =
  /lovable generated project|generated by create next app|vite \+ react|my awesome app|description goes here|lorem ipsum|web site created using create-react-app/i;

export function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  const [first] = trimmed.split(/\s[|–—\-:]\s/);
  return (
    PLACEHOLDER_TITLE.test(trimmed) ||
    PLACEHOLDER_TITLE.test((first ?? "").trim())
  );
}

// Defaults left behind by templates and AI builders. Each one is a plain finding
// ("the share image is still the builder's default"), not a judgement.
export function findTemplateDefaults(
  $: cheerio.CheerioAPI,
  title: string,
  description: string,
): string[] {
  const found: string[] = [];

  if (isPlaceholderTitle(title))
    found.push(
      `the page title is still the template default ("${title.trim()}")`,
    );
  if (PLACEHOLDER_DESCRIPTION.test(description))
    found.push("the page description is still the template default");

  const shareImage = (
    $('meta[property="og:image"]').attr("content") ?? ""
  ).toLowerCase();
  if (
    /lovable\.(dev|app)|bolt\.new|v0\.dev|vercel\.com\/(?:og|api\/og)/.test(
      shareImage,
    )
  ) {
    found.push("the share image is still the site builder's default");
  }

  const author = ($('meta[name="author"]').attr("content") ?? "").trim();
  if (/^lovable$/i.test(author))
    found.push("the author tag still says Lovable");

  const icons = $('link[rel~="icon"]')
    .map((_, element) => ($(element).attr("href") ?? "").toLowerCase())
    .get();
  if (icons.some((href) => /(?:^|\/)(?:vite|next|vercel)\.svg$/.test(href))) {
    found.push("the favicon is still the framework's default");
  }

  return found;
}
