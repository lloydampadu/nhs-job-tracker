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
  const url = `https://jobvisa.co.uk/?s=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job_listing, .job-listing, article, .jobs-list li"));
      return cards.map(card => {
        const titleEl = card.querySelector("h3 a, h2 a, .position a, .job-title a");
        const orgEl = card.querySelector(".company, .employer, .company-name");
        const locationEl = card.querySelector(".location, .job-location");
        const salaryEl = card.querySelector(".salary, .job-salary");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          salary: salaryEl?.innerText?.trim() || "",
        };
      });
    });

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

async function scrapeUNVolunteers(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "it ", "information technology", "frontend", "full stack", "technical", "intern", "volunteer"];
  const pages = [
    "https://www.unv.org/become-volunteer/volunteer-abroad?field_skills_target_id=Information+Technology",
    "https://www.unv.org/become-volunteer/volunteer-abroad?field_country_target_id=Ghana",
  ];
  const seen = new Set();
  const jobs = [];
  for (const pageUrl of pages) {
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      const results = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a[href*='/node/'], a[href*='/volunteer-abroad/'], a[href*='/internship/']"));
        return links.map(a => {
          const title = a.innerText?.trim() || "";
          const url = a.href || "";
          const parent = a.closest("div, li, article") || a.parentElement;
          const allText = parent?.innerText || "";
          const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);
          const org = lines.find(l => l.includes("UN") || l.includes("UNDP") || l.includes("UNFPA") || l.includes("UNICEF")) || "UN Volunteers";
          const location = lines.find(l => l.includes("Ghana") || l.includes("Remote") || l.includes("Home")) || "";
          return { title, url, org, location };
        });
      });
      for (const r of results) {
        if (!r.title || !r.url || seen.has(r.url)) continue;
        const t = r.title.toLowerCase();
        if (!DEV_KEYWORDS.some(k => t.includes(k))) continue;
        seen.add(r.url);
        jobs.push({
          id: slugify(r.title + "-unv-" + r.url.slice(-12)),
          title: r.title,
          organisation: r.org,
          salary: "Volunteer stipend",
          location: r.location || "International",
          closing: "",
          url: r.url.startsWith("http") ? r.url : "https://www.unv.org" + r.url,
          source: "UN Volunteers",
          sponsorship: true,
          found: new Date().toISOString().split("T")[0],
        });
      }
    } catch (e) {
      console.log(`UN Volunteers page failed: ${e.message}`);
    }
  }
  return jobs;
}

async function scrapeUNInternships(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "it ", "information technology", "frontend", "full stack", "technical", "intern"];
  try {
    await page.goto("https://careers.un.org/lbw/home.aspx?viewtype=VW&type=I", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const results = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr, .job-row, .vacancy-row, li"));
      return rows.map(row => {
        const titleEl = row.querySelector("a");
        const text = row.innerText || "";
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        return {
          title: titleEl?.innerText?.trim() || lines[0] || "",
          url: titleEl?.href || "",
          location: lines.find(l => l.includes("Geneva") || l.includes("New York") || l.includes("Nairobi") || l.includes("Ghana") || l.includes("Remote")) || "",
          closing: lines.find(l => l.match(/\d{2}\/\d{2}\/\d{4}/) || l.toLowerCase().includes("deadline")) || "",
        };
      });
    });
    return results
      .filter(j => j.title && j.url)
      .filter(j => DEV_KEYWORDS.some(k => j.title.toLowerCase().includes(k)))
      .map(j => ({
        id: slugify(j.title + "-unintern-" + j.url.slice(-12)),
        title: `[INTERN] ${j.title}`,
        organisation: "United Nations",
        salary: "Unpaid / Subsistence",
        location: j.location || "International",
        closing: j.closing,
        url: j.url.startsWith("http") ? j.url : "https://careers.un.org" + j.url,
        source: "UN Internships",
        sponsorship: true,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`UN Internships failed: ${e.message}`);
    return [];
  }
}

async function scrapeUNDPJobs(page, _term) {
  if (_term !== SEARCH_TERMS[0]) return [];
  const DEV_KEYWORDS = ["developer", "engineer", "software", "web", "digital", "data", "ict", "information technology", "frontend", "full stack", "technical", "consultant"];
  try {
    await page.goto("https://jobs.undp.org/cj_view_jobs.cfm", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const results = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr, .job-row, li"));
      return rows.map(row => {
        const titleEl = row.querySelector("a");
        const text = row.innerText || "";
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        return {
          title: titleEl?.innerText?.trim() || lines[0] || "",
          url: titleEl?.href || "",
          location: lines.find(l => l.length < 50 && l !== (titleEl?.innerText?.trim() || "")) || "",
          closing: lines.find(l => l.match(/\d{4}-\d{2}-\d{2}/) || l.match(/\d{2}\/\d{2}\/\d{4}/)) || "",
        };
      });
    });
    return results
      .filter(j => j.title && j.url)
      .filter(j => DEV_KEYWORDS.some(k => j.title.toLowerCase().includes(k)))
      .map(j => ({
        id: slugify(j.title + "-undp-" + j.url.slice(-12)),
        title: j.title,
        organisation: "UNDP",
        salary: "",
        location: j.location || "International",
        closing: j.closing,
        url: j.url.startsWith("http") ? j.url : "https://jobs.undp.org" + j.url,
        source: "UNDP Jobs",
        sponsorship: true,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`UNDP Jobs failed: ${e.message}`);
    return [];
  }
}

async function scrapeDevex(page, term) {
  const url = `https://jobs.devex.com/jobs?q=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("article, .job-card, .job-listing, [data-testid='job-card']"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, .job-title a, a[href*='/jobs/']");
        const orgEl = card.querySelector(".organization, .company, .employer, .org-name");
        const locationEl = card.querySelector(".location, .job-location");
        const deadlineEl = card.querySelector(".deadline, .closing-date, .date");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          closing: deadlineEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).map(j => ({
      id: slugify(j.title + "-devex-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "International Organisation",
      salary: "",
      location: j.location,
      closing: j.closing,
      url: j.url.startsWith("http") ? j.url : "https://jobs.devex.com" + j.url,
      source: "Devex",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`Devex failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeReliefWeb(page, term) {
  const url = `https://reliefweb.int/jobs?search=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("article, .job, .views-row, li[class*='job']"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, .field-name-title a, a[href*='/job/']");
        const orgEl = card.querySelector(".field-name-field-source, .organization, .source");
        const locationEl = card.querySelector(".field-name-field-country, .location");
        const deadlineEl = card.querySelector(".field-name-field-job-closing-date, .date, .deadline");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          closing: deadlineEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).map(j => ({
      id: slugify(j.title + "-reliefweb-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "NGO / UN Agency",
      salary: "",
      location: j.location,
      closing: j.closing,
      url: j.url.startsWith("http") ? j.url : "https://reliefweb.int" + j.url,
      source: "ReliefWeb",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`ReliefWeb failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeIdealist(page, term) {
  const url = `https://www.idealist.org/en/jobs?q=${encodeURIComponent(term)}&type=JOB`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("[data-testid='listing-card'], .listing-card, article"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, [data-testid='listing-title'] a, a[href*='/en/jobs/']");
        const orgEl = card.querySelector("[data-testid='listing-org'], .org-name, .organization");
        const locationEl = card.querySelector("[data-testid='listing-location'], .location");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).map(j => ({
      id: slugify(j.title + "-idealist-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "NGO",
      salary: "",
      location: j.location,
      closing: "",
      url: j.url.startsWith("http") ? j.url : "https://www.idealist.org" + j.url,
      source: "Idealist",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`Idealist failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeWorkInStartups(page, term) {
  const url = `https://workinstartups.com/job-board/search/?search_keywords=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job_listing, article.job_listing, .job-listing"));
      return cards.map(card => {
        const titleEl = card.querySelector("h3 a, h2 a, .position a");
        const orgEl = card.querySelector(".company, .employer");
        const locationEl = card.querySelector(".location");
        const salaryEl = card.querySelector(".salary");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          salary: salaryEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).filter(j => meetsMinSalary(j.salary)).map(j => ({
      id: slugify(j.title + "-startups-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "UK Startup",
      salary: j.salary,
      location: j.location,
      closing: "",
      url: j.url.startsWith("http") ? j.url : "https://workinstartups.com" + j.url,
      source: "Work In Startups",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`WorkInStartups failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeF6S(page, term) {
  const url = `https://www.f6s.com/jobs?search=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job-card, .job-listing, article, [class*='job']"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, .job-title a, a[href*='/jobs/']");
        const orgEl = card.querySelector(".company, .employer, .startup-name");
        const locationEl = card.querySelector(".location");
        const salaryEl = card.querySelector(".salary, .compensation");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          salary: salaryEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).map(j => ({
      id: slugify(j.title + "-f6s-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "Startup",
      salary: j.salary,
      location: j.location,
      closing: "",
      url: j.url.startsWith("http") ? j.url : "https://www.f6s.com" + j.url,
      source: "F6S",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`F6S failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeHealthcareJobsUK(page, term) {
  const url = `https://www.healthcarejobsuk.co.uk/jobs?keywords=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job, .job-listing, article, .vacancy"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, .job-title a");
        const orgEl = card.querySelector(".company, .employer, .organisation");
        const locationEl = card.querySelector(".location");
        const salaryEl = card.querySelector(".salary");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          salary: salaryEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).filter(j => meetsMinSalary(j.salary)).map(j => ({
      id: slugify(j.title + "-hcjuk-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "Healthcare Organisation",
      salary: j.salary,
      location: j.location,
      closing: "",
      url: j.url.startsWith("http") ? j.url : "https://www.healthcarejobsuk.co.uk" + j.url,
      source: "Healthcare Jobs UK",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`HealthcareJobsUK failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeEHI(page, term) {
  const url = `https://jobs.digitalhealth.net/jobs/?keywords=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job, .job-listing, article, .vacancy, li[class*='job']"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, .job-title a");
        const orgEl = card.querySelector(".company, .employer, .recruiter");
        const locationEl = card.querySelector(".location");
        const salaryEl = card.querySelector(".salary");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || "",
          organisation: orgEl?.innerText?.trim() || "",
          location: locationEl?.innerText?.trim() || "",
          salary: salaryEl?.innerText?.trim() || "",
        };
      });
    });
    return jobs.filter(j => j.title && j.url).filter(j => meetsMinSalary(j.salary)).map(j => ({
      id: slugify(j.title + "-ehi-" + j.url.slice(-12)),
      title: j.title,
      organisation: j.organisation || "Digital Health Organisation",
      salary: j.salary,
      location: j.location,
      closing: "",
      url: j.url.startsWith("http") ? j.url : "https://jobs.digitalhealth.net" + j.url,
      source: "Digital Health Jobs",
      sponsorship: true,
      found: new Date().toISOString().split("T")[0],
    }));
  } catch (e) {
    console.log(`Digital Health Jobs failed for "${term}": ${e.message}`);
    return [];
  }
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
      const isExpired = body.includes("this job has expired") ||
        body.includes("listing has expired") ||
        body.includes("job listing expired") ||
        body.includes("this listing is no longer active") ||
        body.includes("position has been filled") ||
        body.includes("vacancy has closed") ||
        body.includes("application deadline has passed") ||
        body.includes("no longer accepting applications") ||
        document.querySelector(".expired, .job-expired, [class*='expired']") !== null;

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
    { name: "UN Volunteers", fn: scrapeUNVolunteers },
    { name: "UN Internships", fn: scrapeUNInternships },
    { name: "UNDP Jobs", fn: scrapeUNDPJobs },
    { name: "Devex", fn: scrapeDevex },
    { name: "ReliefWeb", fn: scrapeReliefWeb },
    { name: "Idealist", fn: scrapeIdealist },
    { name: "Work In Startups", fn: scrapeWorkInStartups },
    { name: "F6S", fn: scrapeF6S },
    { name: "Healthcare Jobs UK", fn: scrapeHealthcareJobsUK },
    { name: "Digital Health Jobs", fn: scrapeEHI },
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
