export const OLD_SITE = `<!doctype html>
<html><head><title>Home | Sunbright Solar - Johannesburg</title></head>
<body>
<center><font size="2">Sunbright Solar installs solar panels and inverters across Johannesburg and Sandton.</font></center>
<p>Call us on 011 555 0123 or email <a href="mailto:info@sunbright.co.za">info@sunbright.co.za</a>. Gmail users: bob@gmail.com</p>
<footer>Copyright 2016 Sunbright Solar</footer>
</body></html>`;

export const MODERN_SITE = `<!doctype html>
<html><head>
<title>Brightwave Energy | Solar installers in Johannesburg</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Solar and battery storage for homes and businesses in Johannesburg.">
<meta property="og:site_name" content="Brightwave Energy">
<meta property="og:image" content="https://brightwave.co.za/share.png">
</head><body>
<nav><a href="/blog">Blog</a> <a href="/case-studies">Case studies</a></nav>
<main>${"Brightwave Energy designs solar systems and battery storage for Johannesburg homes and businesses. ".repeat(20)}</main>
<a href="https://www.facebook.com/brightwave">Facebook</a>
<a href="https://instagram.com/brightwave">Instagram</a>
<a href="https://www.linkedin.com/company/brightwave">LinkedIn</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<footer>© ${new Date().getUTCFullYear()} Brightwave Energy</footer>
</body></html>`;

const PRETORIA_COPY =
  "Nimbus Labs builds software for logistics companies in Pretoria and Centurion. ".repeat(
    20,
  );

// A Vite + React app straight out of a template: the page is an empty shell and
// everything else (text, links, icons) is added by JavaScript.
export const SPA_SHELL = `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" />
<link rel="icon" type="image/svg+xml" href="/vite.svg" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Vite + React + TS</title>
</head><body>
<div id="root"></div>
<script type="module" crossorigin src="/assets/index-Dk3j2h1a.js"></script>
<noscript>You need to enable JavaScript to run this app.</noscript>
</body></html>`;

// An AI-built startup page. Empty shell, builder defaults in the head, but the
// structured data names the company, the place and the social pages.
export const LOVABLE_SHELL = `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Nimbus Labs | AI software, Pretoria</title>
<meta name="description" content="Lovable Generated Project" />
<meta name="author" content="Lovable" />
<meta property="og:image" content="https://lovable.dev/opengraph-image-p98pqg.png" />
<meta name="twitter:site" content="@nimbuslabs" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Nimbus Labs","address":{"addressLocality":"Pretoria"},"sameAs":["https://www.linkedin.com/company/nimbus-labs"]}</script>
</head><body>
<div id="root"></div>
<script type="module" crossorigin src="/assets/index-Bx91kd0p.js"></script>
</body></html>`;

// A Next.js site that renders on the server, so all the text is in the HTML.
// Modern, but no blog, no case studies and no LinkedIn link.
export const NEXT_STARTUP = `<!doctype html>
<html lang="en"><head>
<title>Nimbus Labs | Software for logistics</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Software for logistics companies in Pretoria." />
<meta property="og:image" content="https://nimbus.example/og.png" />
</head><body>
<div id="__next"><main>${PRETORIA_COPY}</main>
<a href="https://www.instagram.com/nimbuslabs">Instagram</a>
<a href="/careers">Careers</a>
<footer>© ${new Date().getUTCFullYear()} Nimbus Labs</footer></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
<script src="/_next/static/chunks/main.js"></script>
</body></html>`;

// Old-fashioned markup, but with every visibility box ticked, so the only points
// it can earn are for the age of the site.
export const OLD_BUT_VISIBLE = `<!doctype html>
<html><head><title>Sunbright Solar - Johannesburg</title>
<meta name="description" content="Solar in Johannesburg">
<meta property="og:image" content="http://sunbright.co.za/share.png">
</head><body>
<center><font size="2">${"Sunbright Solar installs solar panels across Johannesburg. ".repeat(20)}</font></center>
<a href="/news">News</a> <a href="/clients">Clients</a>
<a href="https://facebook.com/sunbright">f</a>
<a href="https://instagram.com/sunbright">i</a>
<a href="https://linkedin.com/company/sunbright">in</a>
<footer>Copyright 2012 Sunbright Solar</footer>
</body></html>`;
