export type LeadCase =
  | "StrugglingPr"
  | "WeakSocialPresence"
  | "NoWebsite"
  | "OutdatedWebsite"
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
}

export interface Audited {
  candidate: Candidate;
  companyName: string;
  website?: string;
  site?: SiteSignals;
  failure?: { reason: string; status?: number };
}

export interface ReputationResult {
  negative: boolean;
  evidence: Evidence[];
}

export interface ScoredLead {
  audited: Audited;
  case: LeadCase;
  score: number;
  evidence: Evidence[];
}
