export type LeadCase =
  | "StrugglingPr"
  | "WeakSocialPresence"
  | "NoWebsite"
  | "OutdatedWebsite"
  | "LowVisibility"
  | "Other";

export interface Evidence {
  finding: string;
  sourceUrl?: string;
}

// Exactly what the portal's ingest endpoint accepts.
export interface PortalLead {
  companyName: string;
  website?: string;
  industry?: string;
  location?: string;
  email?: string;
  phoneNumber?: string;
  case: LeadCase;
  score: number;
  summary?: string;
  // True for companies we couldn't judge from the homepage alone (or that scored
  // low but look worth a look). They go to the portal's "Needs research" list.
  needsResearch?: boolean;
  researchReason?: string;
  // Short label such as "Next.js · JS-rendered", shown as a chip in the portal.
  siteStack?: string;
  evidence: Evidence[];
}

export interface SearchHit {
  title: string;
  url: string;
  content: string;
}

export interface Candidate {
  // Host with "www." removed. Used to avoid auditing the same company twice.
  host: string;
  // Homepage to audit. Missing when all we found was a social media page.
  url?: string;
  nameHint: string;
  socialOnly?: { url: string; platform: string };
  // Text from the search result, used to check the company really fits.
  snippet: string;
  via: string;
}

export interface SocialLink {
  platform: string;
  url: string;
}

// What a homepage is built with and whether its text is visible to a plain
// fetch. Modern sites (React, Next.js, Vite and AI builders) often send an
// almost empty page and fill it in with JavaScript.
export interface SiteStack {
  frameworks: string[];
  builder: string | null;
  hosting: string | null;
  // True when the HTML we fetched looks like an empty shell, so text, links and
  // social icons are probably added later by JavaScript and can't be judged.
  scriptRendered: boolean;
  // A free starter address (vercel.app, lovable.app, ...) instead of their own domain.
  starterDomain: boolean;
}

export interface SiteSignals {
  url: string;
  https: boolean;
  title: string;
  siteName: string;
  metaDescription: string;
  hasViewport: boolean;
  copyrightYear: number | null;
  legacyMarkup: string[];
  socialLinks: SocialLink[];
  wordCount: number;
  emails: string[];
  phones: string[];
  matchesIndustry: boolean;
  matchesLocation: boolean;
  underConstruction: boolean;
  // Modern-site signals. Only trusted when the page is not script-rendered.
  stack: SiteStack;
  hasShareTags: boolean;
  hasNewsOrBlog: boolean;
  hasCaseStudies: boolean;
  hasCareers: boolean;
  earlyStageText: boolean;
  // Template defaults left in the page head, such as "Vite + React" or a builder's share image.
  templateDefaults: string[];
  // The page title is a template default, so it can't be used as the company name.
  placeholderTitle: boolean;
}

// What we could tell about the company's social media from search results.
export interface SocialProfile {
  platform: string;
  url: string;
  followers?: number;
}

export interface SocialCheck {
  profiles: SocialProfile[];
}

// How sure we are the company fits the industry and place.
export interface Fit {
  industry: boolean;
  location: boolean;
  // True when the homepage couldn't be read, so the search result text was used.
  viaSnippet: boolean;
}

export interface Audited {
  candidate: Candidate;
  companyName: string;
  website?: string;
  site?: SiteSignals;
  failure?: { reason: string; status?: number };
  fit?: Fit;
}

export interface ReputationResult {
  negative: boolean;
  evidence: Evidence[];
}

export interface ScoredLead {
  audited: Audited;
  case: LeadCase;
  // Points for real gaps we found, and a small bonus for things that make a company
  // a good prospect (newer tech, hiring, early stage). The score is both added up.
  score: number;
  needPoints: number;
  fitPoints: number;
  evidence: Evidence[];
}

// A scored company plus the decision about where it goes in the portal.
export interface Triaged {
  lead: ScoredLead;
  needsResearch: boolean;
  researchReasons: string[];
}
