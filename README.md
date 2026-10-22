# Delgender research agent

Finds Johannesburg companies that could use help with PR, social media or their website, and sends them to the staff portal's **Recommended** list for a person to review. It only researches. It never contacts anyone.

Right now it looks for **solar installers in Johannesburg**. Change `agent.config.json` to point it at something else (see below).

## How a run works

1. **Search.** Asks Tavily a handful of questions such as "solar installation installers Sandton". The suburb rotates each day so runs cover different places. Business directories that turn up are opened, and the companies they link to are added.
2. **Check each website.** Plain code, no AI. It looks at: loads over https or not, works on mobile, copyright year in the footer, old page markup, page title and description, how much text there is, links to social accounts, and whether it says "under construction". It also confirms the site really is about the industry and the area, and drops it if not.
3. **Reputation check (needs an AI model).** For the few most promising companies it searches for reviews and complaints and asks the model whether there is a real problem. Only links that were actually in the search results are kept.
4. **Score.** Each finding adds points (weights are at the top of `src/score.ts`). The group with the most points becomes the lead's case: no website, outdated website, weak social presence, or struggling PR. Leads below `minScore` are dropped.
5. **Write a note.** The model writes one or two plain sentences per lead from the findings. Without a model, a plain note is built from the findings instead.
6. **Send.** Posts the leads to the portal. The portal skips anything it already knows (existing leads, dismissed ones, companies already in outreach).

Every run also saves what it found to `out/<run>.json`.

## Setup

1. Get a free key at tavily.com.
2. On the API server, set `ResearchAgent__ApiKey` to a long random secret (24+ characters). Use the same value as `PORTAL_API_KEY` here.
3. Copy `.env.example` to `.env` and fill it in. The AI model settings are optional (see the comments in that file).
4. `npm install`
5. Try it without sending anything: `npm run dry-run`
6. Run for real: `npm run agent`

Node 20.12 or newer is needed.

## Running it automatically (free)

`.github/workflows/research-agent.yml` runs it three mornings a week on GitHub Actions. In the repository's Settings, add these as **secrets**: `TAVILY_API_KEY`, `PORTAL_URL`, `PORTAL_API_KEY`, and optionally `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` and `CONTACT`. You can also start a run by hand from the Actions tab, with a dry-run option. GitHub switches off scheduled runs on repositories with no activity for 60 days, so if it goes quiet, check there first.

## Keeping inside the free limits

- `maxSearchesPerRun` is a hard cap. The agent refuses to search past it, and stops early if Tavily says a limit was reached. A run uses at most that many searches, so with the default of 10 and three runs a week you use roughly 130 a month. Check your plan's current allowance on Tavily's site.
- Reputation checks cost one search each (`reputationChecks`, default 3). They are skipped when no AI model is set.
- AI use is small: at most one call per reputation check plus one call per eight leads.
- Companies already checked are remembered for 60 days (`.state/seen.json`, kept between GitHub runs with a cache), so repeat runs don't waste searches on them.

## Changing what it looks for

Edit `agent.config.json`:

- `industry`, `industryLabel`: what to search for, and how it is labelled in the portal.
- `industryKeywords`: a website must mention one of these to count. Whole words only.
- `city`, `suburbs`, `locationKeywords`: where to look, and what a website must mention to count as local.
- `queryTemplates`: the searches. `{industry}`, `{city}` and `{suburb}` are filled in.
- `minScore`, `maxLeadsPerRun`, `maxSitesToAudit`: how picky to be and how much to look at.

## What it can't do

- **It can't see how active their social media is.** Instagram, Facebook and LinkedIn forbid automated scraping, so the agent doesn't try. It only notices whether a company's website links to social accounts. Staff judge the accounts themselves.
- **"No website" is a best guess.** It means search turned up only a social page. Staff should check before approaching them.
- **Reputation findings are unverified.** The note says so, and links to the sources.
- **It only finds what search returns.** Companies that are hard to find online are hard for it to find too.

## Being polite to websites

It identifies itself in the User-Agent (add `CONTACT` so owners can reach you), fetches only a company's homepage, obeys a `robots.txt` that blocks the whole site, never follows links into private networks, and limits each page to a few seconds and about 1.5 MB. Contact details are limited to addresses on the company's own domain, so personal inboxes are never collected.

## Checks

`npm run typecheck` and `npm test`.
