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

// ── UN VOLUNTEERS — app.unv.org (the real UNV job portal) ────────────────────
async function scrapeUNVolunteersAPI(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant", "it "];
  const searchTerms = ["developer", "ICT", "digital", "data", "technology"];
  const seen = new Set();
  const jobs = [];

  for (const q of searchTerms) {
    try {
      await page.goto(`https://app.unv.org/opportunities?query=${q}&sort=publishedDate%3Adesc`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const results = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll("[class*='opportunity'], [class*='card'], article, .job-card, li[class*='item']"));
        return cards.map(card => {
          const titleEl = card.querySelector("h2 a, h3 a, [class*='title'] a, a[href*='/opportunities/']");
          const orgEl = card.querySelector("[class*='agency'], [class*='organization'], [class*='org']");
          const locationEl = card.querySelector("[class*='location'], [class*='country'], [class*='duty']");
          const dateEl = card.querySelector("[class*='date'], [class*='deadline'], time");
          return {
            title: titleEl?.innerText?.trim() || card.querySelector("h2, h3, [class*='title']")?.innerText?.trim() || "",
            url: titleEl?.href || card.querySelector("a")?.href || "",
            org: orgEl?.innerText?.trim() || "",
            location: locationEl?.innerText?.trim() || "",
            closing: dateEl?.innerText?.trim() || "",
          };
        });
      });
      for (const r of results) {
        if (!r.title || !r.url || seen.has(r.url)) continue;
        if (!DEV_KEYWORDS.some(k => r.title.toLowerCase().includes(k))) continue;
        seen.add(r.url);
        jobs.push({
          id: slugify(r.title + "-unv-" + r.url.slice(-12)),
          title: r.title,
          organisation: r.org || "UN Volunteers",
          salary: "Volunteer Living Allowance",
          location: r.location || "International",
          closing: r.closing,
          url: r.url.startsWith("http") ? r.url : "https://app.unv.org" + r.url,
          source: "UN Volunteers",
          sponsorship: true,
          found: new Date().toISOString().split("T")[0],
        });
      }
    } catch (e) {
      console.log(`  UNV search "${q}" failed: ${e.message}`);
    }
  }
  console.log(`  ✓ UN Volunteers → ${jobs.length} jobs`);
  return jobs;
}

// ── UNDP JOBS — jobs.undp.org ────────────────────────────────────────────────
async function scrapeUNDPJobs(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant", "it "];
  const seen = new Set();
  const jobs = [];

  try {
    await page.goto("https://jobs.undp.org/cj_view_jobs.cfm", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const results = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tr, .job-row, article"));
      return rows.map(row => {
        const links = Array.from(row.querySelectorAll("a"));
        const titleLink = links.find(a => a.href.includes("cj_view_job.cfm") || a.href.includes("/job/"));
        const cells = Array.from(row.querySelectorAll("td"));
        return {
          title: titleLink?.innerText?.trim() || "",
          url: titleLink?.href || "",
          location: cells[1]?.innerText?.trim() || "",
          closing: cells[2]?.innerText?.trim() || "",
        };
      });
    });
    for (const r of results) {
      if (!r.title || !r.url || seen.has(r.url)) continue;
      if (!DEV_KEYWORDS.some(k => r.title.toLowerCase().includes(k))) continue;
      seen.add(r.url);
      jobs.push({
        id: slugify(r.title + "-undp-" + r.url.slice(-12)),
        title: r.title,
        organisation: "UNDP",
        salary: "",
        location: r.location || "International",
        closing: r.closing,
        url: r.url.startsWith("http") ? r.url : "https://jobs.undp.org" + r.url,
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
    await page.goto("https://career5.successfactors.eu/career?company=PlanInterworP&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const results = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr.jobResultItem, [class*='jobResult'], article, .job-listing"));
      return rows.map(row => {
        const titleEl = row.querySelector("a[id*='jobTitle'], a[class*='jobTitle'], h3 a, a");
        const locationEl = row.querySelector("[class*='Location'], .location, td:nth-child(2)");
        const dateEl = row.querySelector("[class*='Date'], .date, td:nth-child(3)");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          location: locationEl?.innerText?.trim() || "",
          closing: dateEl?.innerText?.trim() || "",
        };
      });
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
