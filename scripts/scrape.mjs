import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────────────────────────
const MIN_SALARY = 30000;
const EMAIL_TO = "lloydampadu18@gmail.com";

const SEARCH_TERMS = [
  "software developer",
  "web developer",
  "full stack developer",
  "frontend developer",
  "javascript developer",
  "react developer",
  "next.js developer",
  "node.js developer",
  "application developer",
  "digital developer",
  "EPR configuration developer",
  "junior developer",
  "graduate developer",
];

// ── QUALITY FILTER ────────────────────────────────────────────────────────────
// Job title MUST contain at least one of these
const RELEVANT_TITLE_KEYWORDS = [
  "developer", "engineer", "software", "web", "frontend", "front-end",
  "full stack", "fullstack", "javascript", "typescript", "react", "next.js",
  "node", "digital", "epr", "configuration", "application", "technical",
  "it support", "systems", "integration", "devops", "data", "programmer",
];

// Job title must NOT contain any of these (irrelevant roles that slip through)
const EXCLUDE_TITLE_KEYWORDS = [
  "pharmacist", "nurse", "doctor", "clinical", "therapist", "midwife",
  "physiotherapist", "radiographer", "paramedic", "surgeon", "physician",
  "dentist", "optometrist", "psychologist", "counsellor", "social worker",
  "business development manager", "sales", "recruiter", "hr ", "finance",
  "accountant", "marketing", "administrator", "receptionist", "housekeeper",
  "porter", "cleaner", "chef", "driver", "security", "teaching assistant",
  "learning disability", "mental health worker", "care assistant",
];

function isRelevantJob(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  const hasRelevant = RELEVANT_TITLE_KEYWORDS.some(k => t.includes(k));
  const isExcluded = EXCLUDE_TITLE_KEYWORDS.some(k => t.includes(k));
  return hasRelevant && !isExcluded;
}

// Priority scoring — higher = shown first on dashboard
function getPriority(job) {
  const t = job.title.toLowerCase();
  let score = 0;
  if (job.sponsorship) score += 50;
  if (t.includes("javascript") || t.includes("react") || t.includes("next") || t.includes("node")) score += 30;
  if (t.includes("full stack") || t.includes("fullstack")) score += 25;
  if (t.includes("epr") || t.includes("configuration")) score += 20;
  if (t.includes("frontend") || t.includes("front-end") || t.includes("web developer")) score += 20;
  if (t.includes("software developer") || t.includes("software engineer")) score += 20;
  if (t.includes("digital developer")) score += 15;
  if (t.includes("junior") || t.includes("graduate")) score += 10;
  // salary bonus
  const sal = parseInt((job.salary || "").replace(/[^0-9]/g, "") || "0");
  if (sal >= 50000) score += 15;
  if (sal >= 40000) score += 10;
  if (sal >= 35000) score += 5;
  return score;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function parseSalary(text) {
  if (!text) return 0;
  const match = text.replace(/,/g, "").match(/£?([\d]+)/);
  return match ? parseInt(match[1]) : 0;
}

function meetsMinSalary(salaryText) {
  if (!salaryText) return true; // include if unknown
  const val = parseSalary(salaryText);
  return val === 0 || val >= MIN_SALARY;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
}

// ── SCRAPERS ──────────────────────────────────────────────────────────────────

async function scrapeNHSJobs(page, term) {
  const url = `https://www.jobs.nhs.uk/candidate/search/results?keyword=${encodeURIComponent(term)}&visa_sponsorship=1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const jobs = [];
  let pageNum = 1;

  while (pageNum <= 5) {
    const results = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('li[data-test="search-result"], .search-result, article'));
      return cards.map(card => {
        const anchors = Array.from(card.querySelectorAll("a"));
        const titleAnchor = anchors.find(a => a.href.includes("/candidate/jobadvert/"));
        const text = card.innerText || "";
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        return {
          title: titleAnchor?.innerText?.trim() || lines[0] || "",
          url: titleAnchor?.href || "",
          rawText: lines.slice(0, 8).join(" | "),
        };
      });
    });

    for (const r of results) {
      if (r.title && r.url) {
        const lines = r.rawText.split(" | ");
        const salary = lines.find(l => l.includes("Salary:")) || "";
        const org = lines.find(l => l.includes("Trust") || l.includes("NHS") || l.includes("Hospital")) || lines[1] || "";
        const location = lines.find(l => l.match(/[A-Z]{1,2}[0-9]/)) || "";
        const closing = lines.find(l => l.includes("Closing")) || "";

        if (meetsMinSalary(salary)) {
          jobs.push({
            id: slugify(r.title + "-" + r.url.slice(-10)),
            title: r.title,
            organisation: org.trim(),
            salary: salary.replace("Salary: ", "").trim(),
            location: location.trim(),
            closing: closing.replace("Closing date: ", "").trim(),
            url: r.url,
            source: "NHS Jobs",
            sponsorship: true,
            found: new Date().toISOString().split("T")[0],
          });
        }
      }
    }

    const nextBtn = page.locator('a[rel="next"], a[aria-label="Next page"], [data-test="next-page"]').first();
    const hasNext = await nextBtn.isVisible().catch(() => false);
    if (!hasNext) break;
    await nextBtn.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    pageNum++;
  }

  return jobs;
}


async function scrapeJobVisa(page, term) {
  // Use job_listing search with date ordering to get recent posts only
  const url = `https://jobvisa.co.uk/?post_type=job_listing&s=${encodeURIComponent(term)}&orderby=date&order=desc`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const jobs = await page.evaluate((cutoffTime) => {
      const cards = Array.from(document.querySelectorAll(".job_listing, .job-listing, article, .jobs-list li"));
      return cards.map(card => {
        const titleEl = card.querySelector("h3 a, h2 a, .position a, .job-title a");
        const orgEl = card.querySelector(".company, .employer, .company-name");
        const locationEl = card.querySelector(".location, .job-location");
        const salaryEl = card.querySelector(".salary, .job-salary");
        const dateEl = card.querySelector("time, .date, .posted, [datetime]");
        const dateStr = dateEl?.getAttribute("datetime") || dateEl?.innerText?.trim() || "";
        // Skip if posted more than 30 days ago
        if (dateStr) {
          const posted = new Date(dateStr).getTime();
          if (posted && posted < cutoffTime) return null;
        }
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          salary: salaryEl?.innerText?.trim() || "",
        };
      }).filter(Boolean);
    }, thirtyDaysAgo.getTime());

    return jobs
      .filter(j => j.title && j.url)
      .filter(j => meetsMinSalary(j.salary))
      .map(j => ({
        id: slugify(j.title + "-jobvisa-" + j.url.slice(-10)),
        title: j.title,
        organisation: j.organisation,
        salary: j.salary,
        location: j.location,
        closing: "",
        url: j.url,
        source: "JobVisa UK",
        sponsorship: true,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`JobVisa failed for "${term}": ${e.message}`);
    return [];
  }
}


async function scrapeUNJobs(page, _term) {
  // unjobs.org blocks search endpoint — browse category pages instead
  // Only run once (ignore per-term calls) by checking a flag
  if (_term !== SEARCH_TERMS[0]) return [];

  const pages = [
    "https://unjobs.org/duty_stations/home-based",
    "https://unjobs.org/duty_stations/remote",
    "https://unjobs.org/duty_stations/ghana",
    "https://unjobs.org/",
  ];

  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "it ", "information technology", "frontend", "full stack", "technical"];

  const seen = new Set();
  const jobs = [];

  for (const pageUrl of pages) {
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);

      const results = await page.evaluate(() => {
        // All vacancy links follow /vacancies/[numeric_id]
        const links = Array.from(document.querySelectorAll("a[href*='/vacancies/']"));
        return links.map(a => {
          const title = a.innerText?.trim() || "";
          const url = a.href || "";
          // Organisation is usually in the next sibling text or parent's next element
          const parent = a.closest("div, li, td, tr") || a.parentElement;
          const allText = parent?.innerText || "";
          const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);
          const titleIdx = lines.findIndex(l => l === title);
          const org = lines[titleIdx + 1] || "";
          return { title, url, org };
        });
      });

      for (const r of results) {
        if (!r.title || !r.url || seen.has(r.url)) continue;
        const t = r.title.toLowerCase();
        if (!DEV_KEYWORDS.some(k => t.includes(k))) continue;
        seen.add(r.url);
        jobs.push({
          id: slugify(r.title + "-unjobs-" + r.url.slice(-12)),
          title: r.title,
          organisation: r.org || "UN Agency",
          salary: "",
          location: pageUrl.includes("ghana") ? "Ghana" : "Remote / Home-based",
          closing: "",
          url: r.url,
          source: "UN Jobs",
          sponsorship: true,
          found: new Date().toISOString().split("T")[0],
        });
      }
    } catch (e) {
      console.log(`UN Jobs page ${pageUrl} failed: ${e.message}`);
    }
  }

  return jobs;
}

// ── RELIEFWEB API — covers UNICEF, UNDP, Plan International, Save the Children,
//    ActionAid, World Vision, UN Women, WHO, WFP and hundreds of other NGOs ─────
// ── RELIEFWEB — scrape jobs page directly (API v1 decommissioned, v2 needs key)
async function scrapeReliefWebAPI(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant", "it officer", "ict associate"];
  const searchTerms = ["developer", "ICT", "digital+technology", "software", "data"];
  const seen = new Set();
  const jobs = [];

  for (const q of searchTerms) {
    try {
      await page.goto(`https://reliefweb.int/jobs?search=${q}&advanced-search=%28TY.6%29`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      const results = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll("article, .rw-river-article, [class*='article'], .rw-search-results li"));
        return items.map(item => {
          const titleEl = item.querySelector("h3 a, h2 a, .rw-river-article__title a, a[href*='/job/']");
          const orgEl = item.querySelector(".rw-river-article__source, .source, [class*='source']");
          const countryEl = item.querySelector(".rw-river-article__country, .country, [class*='country']");
          const dateEl = item.querySelector("time, .date, [class*='date']");
          return {
            title: titleEl?.innerText?.trim() || "",
            url: titleEl?.href || "",
            org: orgEl?.innerText?.trim() || "",
            country: countryEl?.innerText?.trim() || "",
            closing: dateEl?.innerText?.trim() || "",
          };
        });
      });
      for (const r of results) {
        if (!r.title || !r.url || seen.has(r.url)) continue;
        if (!DEV_KEYWORDS.some(k => r.title.toLowerCase().includes(k))) continue;
        seen.add(r.url);
        jobs.push({
          id: slugify(r.title + "-rw-" + r.url.slice(-12)),
          title: r.title,
          organisation: r.org || "NGO / UN Agency",
          salary: "",
          location: r.country || "International",
          closing: r.closing,
          url: r.url.startsWith("http") ? r.url : "https://reliefweb.int" + r.url,
          source: "ReliefWeb",
          sponsorship: true,
          found: new Date().toISOString().split("T")[0],
        });
      }
    } catch (e) {
      console.log(`  ReliefWeb search "${q}" failed: ${e.message}`);
    }
  }
  console.log(`  ✓ ReliefWeb → ${jobs.length} jobs`);
  return jobs;
}

// ── UN VOLUNTEERS — app.unv.org (SPA, needs networkidle + wait) ──────────────
async function scrapeUNVolunteersAPI(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant", "it "];
  const searchTerms = ["developer", "ICT", "digital", "data"];
  const seen = new Set();
  const jobs = [];

  for (const q of searchTerms) {
    try {
      await page.goto(`https://app.unv.org/opportunities?query=${q}`, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(5000); // SPA needs time to render
      const results = await page.evaluate(() => {
        // Grab all links — the SPA renders opportunities as anchor tags
        const links = Array.from(document.querySelectorAll("a[href*='/opportunities/']"));
        return links.map(a => {
          const container = a.closest("div, li, article, section") || a.parentElement;
          const text = container?.innerText || a.innerText || "";
          const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
          return {
            title: lines[0] || a.innerText?.trim() || "",
            url: a.href || "",
            allText: lines.slice(0, 6).join(" | "),
          };
        });
      });
      for (const r of results) {
        if (!r.title || !r.url || seen.has(r.url) || r.title.length < 5) continue;
        if (!DEV_KEYWORDS.some(k => r.title.toLowerCase().includes(k))) continue;
        seen.add(r.url);
        jobs.push({
          id: slugify(r.title + "-unv-" + r.url.slice(-12)),
          title: r.title,
          organisation: "UN Volunteers",
          salary: "Volunteer Living Allowance",
          location: "International",
          closing: "",
          url: r.url.startsWith("http") ? r.url : "https://app.unv.org" + r.url,
          source: "UN Volunteers",
          sponsorship: true,
          found: new Date().toISOString().split("T")[0],
          snippet: r.allText,
        });
      }
    } catch (e) {
      console.log(`  UNV search "${q}" failed: ${e.message}`);
    }
  }
  console.log(`  ✓ UN Volunteers → ${jobs.length} jobs`);
  return jobs;
}

// ── UNDP JOBS — jobs.undp.org (links now go to oraclecloud.com) ──────────────
async function scrapeUNDPJobs(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant", "it "];
  const seen = new Set();
  const jobs = [];

  try {
    await page.goto("https://jobs.undp.org/cj_view_jobs.cfm", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const results = await page.evaluate(() => {
      // UNDP now links to Oracle Cloud — grab all job links
      const links = Array.from(document.querySelectorAll("a[href*='oraclecloud.com'], a[href*='cj_view_job']"));
      return links.map(a => {
        const container = a.closest("div, li, tr") || a.parentElement;
        const text = container?.innerText || "";
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        // Structure: title, level, deadline, org, location
        return {
          title: lines[0] || a.innerText?.trim() || "",
          url: a.href || "",
          location: lines[4] || lines[3] || "",
          closing: lines[2] || "",
        };
      });
    });
    for (const r of results) {
      if (!r.title || !r.url || seen.has(r.url) || r.title.length < 5) continue;
      if (!DEV_KEYWORDS.some(k => r.title.toLowerCase().includes(k))) continue;
      seen.add(r.url);
      jobs.push({
        id: slugify(r.title + "-undp-" + r.url.slice(-12)),
        title: r.title,
        organisation: "UNDP",
        salary: "",
        location: r.location || "International",
        closing: r.closing,
        url: r.url,
        source: "UNDP Jobs",
        sponsorship: true,
        found: new Date().toISOString().split("T")[0],
      });
    }
  } catch (e) {
    console.log(`UNDP Jobs failed: ${e.message}`);
  }
  console.log(`  ✓ UNDP Jobs → ${jobs.length} jobs`);
  return jobs;
}

// ── PLAN INTERNATIONAL — career5.successfactors.eu ──────────────────────────
async function scrapePlanInternational(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant", "it "];
  const seen = new Set();
  const jobs = [];

  try {
    await page.goto("https://career5.successfactors.eu/career?company=PlanInterworP&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH", { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(5000);
    const results = await page.evaluate(() => {
      // SuccessFactors renders job listings in various ways — grab all links with job-like hrefs
      const links = Array.from(document.querySelectorAll("a[href*='job'], a[id*='job'], a[id*='Job']"));
      const rows = Array.from(document.querySelectorAll("tr[class*='job'], tr[class*='Job'], [class*='jobResult']"));
      const items = [];
      // Try link-based extraction
      links.forEach(a => {
        const title = a.innerText?.trim() || "";
        const url = a.href || "";
        const parent = a.closest("tr, div, li") || a.parentElement;
        const allText = parent?.innerText || "";
        items.push({ title, url, location: "", closing: "", allText });
      });
      // Try row-based extraction
      rows.forEach(row => {
        const titleEl = row.querySelector("a");
        const cells = Array.from(row.querySelectorAll("td"));
        items.push({
          title: titleEl?.innerText?.trim() || cells[0]?.innerText?.trim() || "",
          url: titleEl?.href || "",
          location: cells[1]?.innerText?.trim() || "",
          closing: cells[2]?.innerText?.trim() || "",
          allText: row.innerText,
        });
      });
      return items;
    });
    for (const r of results) {
      if (!r.title || !r.url || seen.has(r.url)) continue;
      if (!DEV_KEYWORDS.some(k => r.title.toLowerCase().includes(k))) continue;
      seen.add(r.url);
      jobs.push({
        id: slugify(r.title + "-plan-" + r.url.slice(-12)),
        title: r.title,
        organisation: "Plan International",
        salary: "",
        location: r.location || "International",
        closing: r.closing,
        url: r.url,
        source: "Plan International",
        sponsorship: true,
        found: new Date().toISOString().split("T")[0],
      });
    }
  } catch (e) {
    console.log(`Plan International failed: ${e.message}`);
  }
  console.log(`  ✓ Plan International → ${jobs.length} jobs`);
  return jobs;
}


// ── GOOGLE SUMMER OF CODE — summerofcode.withgoogle.com ──────────────────────
async function scrapeGSoC(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return []; // only run once
  const jobs = [];
  try {
    await page.goto("https://summerofcode.withgoogle.com/programs/2026/organizations", { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(5000);
    const results = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("a[href*='/organizations/']"));
      return cards.map(card => {
        const name = card.querySelector("h3, h4, [class*='name'], span")?.innerText?.trim() || "";
        const desc = card.querySelector("p, [class*='desc'], [class*='tagline']")?.innerText?.trim() || "";
        const href = card.href || "";
        const techs = Array.from(card.querySelectorAll("[class*='tech'], [class*='tag'], .chip, .badge")).map(t => t.innerText.trim().toLowerCase());
        return { name, desc, href, techs: techs.join(" ") };
      });
    });
    const DEV_KEYWORDS = ["javascript", "typescript", "react", "web", "frontend", "node", "python", "django", "flask", "html", "css", "next"];
    for (const r of results) {
      if (!r.name || !r.href) continue;
      const text = (r.name + " " + r.desc + " " + r.techs).toLowerCase();
      if (!DEV_KEYWORDS.some(k => text.includes(k))) continue;
      jobs.push({
        id: slugify("gsoc-2026-" + r.name),
        title: `GSoC 2026: ${r.name}`,
        organisation: "Google Summer of Code",
        salary: "$1,500–$6,600 stipend",
        location: "Remote",
        closing: "",
        url: r.href,
        source: "GSoC",
        sponsorship: false,
        found: new Date().toISOString().split("T")[0],
        snippet: r.desc.slice(0, 300),
      });
    }
  } catch (e) {
    console.log(`GSoC failed: ${e.message}`);
  }
  console.log(`  ✓ GSoC → ${jobs.length} organizations`);
  return jobs;
}

// ── OUTREACHY — outreachy.org ────────────────────────────────────────────────
async function scrapeOutreachy(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const jobs = [];
  try {
    await page.goto("https://www.outreachy.org/apply/project-selection/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const results = await page.evaluate(() => {
      const projects = [];
      const cards = document.querySelectorAll(".card, article, [class*='project'], section.card");
      cards.forEach(card => {
        const titleEl = card.querySelector("h3 a, h4 a, h2 a, a[href*='/outreachy/']");
        const orgEl = card.querySelector("h2, h3, [class*='org']");
        const skillEls = card.querySelectorAll("td, [class*='skill'], .badge, span");
        const skills = Array.from(skillEls).map(s => s.innerText.trim()).filter(s => s.length < 40);
        return;
      });
      // Alternative: grab all links that look like project links
      const links = Array.from(document.querySelectorAll("a"));
      links.forEach(a => {
        const text = a.innerText.trim();
        const href = a.href;
        if (text.length > 10 && text.length < 200 && href.includes("outreachy.org")) {
          projects.push({ title: text, url: href });
        }
      });
      // Get the full page text to extract org names
      const body = document.body.innerText;
      return { projects, body: body.slice(0, 5000) };
    });
    // Parse projects from the page
    const DEV_KEYWORDS = ["python", "javascript", "typescript", "react", "web", "frontend", "node", "django", "flask", "api", "html", "css", "database", "fullstack", "full-stack", "software"];
    const seen = new Set();
    for (const p of results.projects) {
      if (!p.title || seen.has(p.url)) continue;
      const text = p.title.toLowerCase();
      if (text.includes("sign in") || text.includes("apply") || text.includes("home") || text.length < 15) continue;
      if (!DEV_KEYWORDS.some(k => text.includes(k)) && !text.includes("develop") && !text.includes("engineer") && !text.includes("build")) continue;
      seen.add(p.url);
      jobs.push({
        id: slugify("outreachy-" + p.title),
        title: p.title.slice(0, 120),
        organisation: "Outreachy",
        salary: "$7,000 stipend",
        location: "Remote",
        closing: "",
        url: p.url,
        source: "Outreachy",
        sponsorship: false,
        found: new Date().toISOString().split("T")[0],
      });
    }
  } catch (e) {
    console.log(`Outreachy failed: ${e.message}`);
  }
  console.log(`  ✓ Outreachy → ${jobs.length} projects`);
  return jobs;
}

// ── CERN — careers.cern ─────────────────────────────────────────────────────
async function scrapeCERN(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["software", "developer", "engineer", "web", "full-stack", "full stack", "frontend", "data", "machine learning", "devops", "ict", "computing", "digital", "studentship", "internship", "technical student"];
  const jobs = [];
  const seen = new Set();

  try {
    await page.goto("https://careers.cern/jobs", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const results = await page.evaluate(() => {
      const items = [];
      const links = Array.from(document.querySelectorAll("a[href*='/jobs/']"));
      links.forEach(a => {
        const title = a.querySelector("h2, h3, h4, span")?.innerText?.trim() || a.innerText.trim();
        const href = a.href;
        const parent = a.closest("div, article, li, section");
        const meta = parent?.innerText || "";
        items.push({ title, url: href, meta: meta.slice(0, 300) });
      });
      return items;
    });
    for (const r of results) {
      if (!r.title || !r.url || seen.has(r.url)) continue;
      const text = (r.title + " " + r.meta).toLowerCase();
      if (!DEV_KEYWORDS.some(k => text.includes(k))) continue;
      seen.add(r.url);
      const contractMatch = r.meta.match(/(\d+[\-–]\d+\s*month|\d+\s*month)/i);
      jobs.push({
        id: slugify("cern-" + r.title),
        title: r.title,
        organisation: "CERN",
        salary: contractMatch ? contractMatch[0] + " contract" : "",
        location: "Geneva, Switzerland",
        closing: "",
        url: r.url,
        source: "CERN",
        sponsorship: true, // CERN sponsors all international hires
        found: new Date().toISOString().split("T")[0],
        snippet: r.meta.slice(0, 300),
      });
    }
  } catch (e) {
    console.log(`CERN failed: ${e.message}`);
  }
  console.log(`  ✓ CERN → ${jobs.length} jobs`);
  return jobs;
}

// ── TONY ELUMELU FOUNDATION — tonyelumelufoundation.org ──────────────────────
async function scrapeTEF(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const jobs = [];
  try {
    await page.goto("https://www.tonyelumelufoundation.org/programmes", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const results = await page.evaluate(() => {
      const items = [];
      const links = Array.from(document.querySelectorAll("a[href*='programme'], a[href*='africa'], a[href*='entrepreneur']"));
      links.forEach(a => {
        const title = a.innerText.trim();
        const href = a.href;
        if (title.length > 5 && title.length < 150 && !title.includes("FAQ")) {
          items.push({ title, url: href });
        }
      });
      return items;
    });
    const seen = new Set();
    for (const r of results) {
      if (!r.title || seen.has(r.url) || !r.url) continue;
      seen.add(r.url);
      jobs.push({
        id: slugify("tef-" + r.title),
        title: r.title,
        organisation: "Tony Elumelu Foundation",
        salary: "Up to $5,000 seed funding",
        location: "Africa (Remote)",
        closing: "",
        url: r.url,
        source: "TEF",
        sponsorship: false,
        found: new Date().toISOString().split("T")[0],
      });
    }
  } catch (e) {
    console.log(`TEF failed: ${e.message}`);
  }
  console.log(`  ✓ TEF → ${jobs.length} programmes`);
  return jobs;
}

// ── DEAL-BREAKER CHECK (for Lloyd's profile) ─────────────────────────────────
// These are hard requirements Lloyd definitely doesn't meet
const DEAL_BREAKERS = [
  "cerner", "epic bridges", "intersystems", "healthshare", "cach objectscript",
  "hl7", "fhir", "mirth connect", "blue prism", "automation anywhere", "uipath",
  "power automate", "power apps", "powerbi", "5 years", "7 years", "10 years",
  "master's degree", "masters degree", "phd",
];

// Things that are a GOOD sign for Lloyd
const GREEN_FLAGS = [
  "javascript", "typescript", "react", "next.js", "nodejs", "node.js",
  "postgresql", "sql", "html", "css", "rest api", "api", "git",
  "agile", "scrum", "full stack", "web development", "sponsorship",
  "visa sponsorship", "skilled worker",
];

async function fetchJobDetail(page, job) {
  const isNHS = job.url.includes("jobs.nhs.uk");
  const isJobVisa = job.url.includes("jobvisa.co.uk");
  if (!isNHS && !isJobVisa) return job; // only detail-scrape NHS Jobs and JobVisa
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    const detail = await page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      const fullText = document.body.innerText;

      // Expired listing detection
      const isJobVisa = window.location.hostname.includes("jobvisa");
      const hasApplyButton = document.querySelector("a[href*='apply'], button[class*='apply'], .application_form, a.apply_button, input[type='submit']") !== null;
      const isExpired = body.includes("this job has expired") ||
        body.includes("listing has expired") ||
        body.includes("job listing expired") ||
        body.includes("this listing is no longer active") ||
        body.includes("position has been filled") ||
        body.includes("vacancy has closed") ||
        body.includes("application deadline has passed") ||
        body.includes("no longer accepting applications") ||
        document.querySelector(".expired, .job-expired, [class*='expired']") !== null ||
        (isJobVisa && !hasApplyButton); // JobVisa: no apply button = expired

      // Sponsorship — explicit check
      const sponsorshipConfirmed = body.includes("certificate of sponsorship") &&
        !body.includes("not eligible for visa sponsorship") &&
        !body.includes("unable to offer visa sponsorship") &&
        !body.includes("cannot offer sponsorship") &&
        !body.includes("does not offer sponsorship");

      const noSponsorship = body.includes("not eligible for visa sponsorship") ||
        body.includes("unable to offer visa sponsorship") ||
        body.includes("cannot offer sponsorship") ||
        body.includes("does not offer sponsorship");

      // Closing date
      const closingMatch = fullText.match(/closing date[^\d]*(\d{1,2}[\s\-\/]\w+[\s\-\/]?\d{0,4})/i);
      const closing = closingMatch ? closingMatch[1].trim() : "";

      // Person spec essential
      const essentialSection = fullText.match(/essential[\s\S]{0,2000}/i)?.[0] || "";

      // Summary snippet — first 400 chars of job summary
      const summaryEl = document.querySelector(".nhsuk-body, .job-summary, p");
      const snippet = summaryEl?.innerText?.trim().slice(0, 400) || fullText.slice(0, 400);

      return { body, isExpired, sponsorshipConfirmed, noSponsorship, closing, essentialSection, snippet };
    });

    // Skip expired listings entirely
    if (detail.isExpired) {
      return { ...job, _expired: true };
    }

    // Check deal-breakers against full text
    const dealBreakersFound = DEAL_BREAKERS.filter(d => detail.body.includes(d));
    const greenFlagsFound = GREEN_FLAGS.filter(g => detail.body.includes(g));

    // Fit score adjustment
    let fitAdjustment = 0;
    fitAdjustment -= dealBreakersFound.length * 15;
    fitAdjustment += greenFlagsFound.length * 5;
    if (detail.noSponsorship) fitAdjustment -= 200; // auto-bury
    if (detail.sponsorshipConfirmed) fitAdjustment += 30;

    return {
      ...job,
      sponsorship: detail.noSponsorship ? false : (detail.sponsorshipConfirmed || job.sponsorship),
      noSponsorship: detail.noSponsorship,
      closing: detail.closing || job.closing,
      dealBreakers: dealBreakersFound,
      greenFlags: greenFlagsFound,
      snippet: detail.snippet,
      priority: Math.max(0, (job.priority || 0) + fitAdjustment),
      detailScraped: true,
    };
  } catch (e) {
    return job; // if detail fetch fails, keep original
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  const allJobs = new Map();

  const scrapers = [
    { name: "NHS Jobs", fn: scrapeNHSJobs },
    { name: "JobVisa UK", fn: scrapeJobVisa },
    { name: "UN Jobs", fn: scrapeUNJobs },
    { name: "ReliefWeb", fn: scrapeReliefWebAPI },
    { name: "UN Volunteers", fn: scrapeUNVolunteersAPI },
    { name: "UNDP Jobs", fn: scrapeUNDPJobs },
    { name: "Plan International", fn: scrapePlanInternational },
    { name: "GSoC", fn: scrapeGSoC },
    { name: "Outreachy", fn: scrapeOutreachy },
    { name: "CERN", fn: scrapeCERN },
    { name: "TEF", fn: scrapeTEF },
  ];

  for (const scraper of scrapers) {
    console.log(`\n🌐 Scraping ${scraper.name}...`);
    for (const term of SEARCH_TERMS) {
      try {
        const jobs = await scraper.fn(page, term);
        for (const job of jobs) {
          if (!allJobs.has(job.id)) allJobs.set(job.id, job);
        }
        console.log(`  ✓ "${term}" → ${jobs.length} jobs`);
      } catch (e) {
        console.log(`  ✗ "${term}" failed: ${e.message}`);
      }
    }
  }

  // Filter to relevant jobs only + add priority score
  const filtered = Array.from(allJobs.values())
    .filter(j => isRelevantJob(j.title))
    .map(j => ({ ...j, priority: getPriority(j) }))
    .sort((a, b) => b.priority - a.priority);

  console.log(`\n📋 ${filtered.length} quality-filtered jobs — fetching full details for NHS Jobs & JobVisa...`);

  // Fetch detail pages for top NHS Jobs and all JobVisa jobs
  const nhsJobs = filtered.filter(j => j.source === "NHS Jobs").slice(0, 60);
  const jobVisaJobs = filtered.filter(j => j.source === "JobVisa UK");
  const otherJobs = filtered.filter(j => j.source !== "NHS Jobs" && j.source !== "JobVisa UK");

  const jobsToDetail = [...nhsJobs, ...jobVisaJobs];
  let detailedJobs = [];
  for (let i = 0; i < jobsToDetail.length; i++) {
    const job = jobsToDetail[i];
    process.stdout.write(`  [${i+1}/${jobsToDetail.length}] ${job.title.slice(0,50)}...`);
    const detailed = await fetchJobDetail(page, job);
    if (detailed._expired) {
      process.stdout.write(" ⏰ expired — skipped\n");
    } else if (detailed.noSponsorship) {
      process.stdout.write(" ❌ no sponsorship\n");
    } else if (detailed.dealBreakers?.length > 0) {
      process.stdout.write(` ⚠️  deal-breakers: ${detailed.dealBreakers.slice(0,3).join(", ")}\n`);
    } else {
      process.stdout.write(` ✓ priority: ${detailed.priority}\n`);
    }
    detailedJobs.push(detailed);
  }

  // Remove expired and no-sponsorship jobs
  const goodNHSJobs = detailedJobs.filter(j => !j._expired && !j.noSponsorship);

  const results = [...goodNHSJobs, ...otherJobs]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  await browser.close();

  console.log(`\n✅ Total quality jobs (sponsorship confirmed/possible): ${results.length}`);

  // Load existing jobs to find NEW ones
  const dataPath = path.join(__dirname, "../data/jobs.json");
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch {}

  const existingIds = new Set(existing.map(j => j.id));
  const newJobs = results.filter(j => !existingIds.has(j.id));
  console.log(`🆕 New jobs since last run: ${newJobs.length}`);

  // Save updated jobs (keep last 500, newest first)
  const merged = [...results, ...existing.filter(j => !allJobs.has(j.id))].slice(0, 500);
  fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2));
  console.log(`💾 Saved ${merged.length} jobs to data/jobs.json`);

  // Save new jobs for email
  fs.writeFileSync(path.join(__dirname, "../data/new-jobs.json"), JSON.stringify(newJobs, null, 2));

  // Output summary for GitHub Actions
  console.log(`::set-output name=new_count::${newJobs.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
