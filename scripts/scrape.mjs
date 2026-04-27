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

async function scrapeIndeed(page, term) {
  const url = `https://uk.indeed.com/jobs?q=${encodeURIComponent(term)}&l=United+Kingdom&sc=0kf%3Aattr(DSQF7)%3B&fromage=7`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job_seen_beacon, .tapItem, [data-testid='job-card']"));
      return cards.map(card => {
        const titleEl = card.querySelector("[data-testid='jobTitle'], .jobTitle a, h2 a");
        const orgEl = card.querySelector("[data-testid='company-name'], .companyName");
        const locationEl = card.querySelector("[data-testid='text-location'], .companyLocation");
        const salaryEl = card.querySelector("[data-testid='attribute_snippet_testid'], .salary-snippet");
        return {
          title: titleEl?.innerText?.trim() || "",
          url: titleEl?.href || titleEl?.closest("a")?.href || "",
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
        id: slugify(j.title + "-indeed-" + j.url.slice(-10)),
        title: j.title,
        organisation: j.organisation,
        salary: j.salary,
        location: j.location,
        closing: "",
        url: j.url.startsWith("http") ? j.url : "https://uk.indeed.com" + j.url,
        source: "Indeed",
        sponsorship: true,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`Indeed failed for "${term}": ${e.message}`);
    return [];
  }
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

async function scrapeCWJobs(page, term) {
  const url = `https://www.cwjobs.co.uk/jobs/${encodeURIComponent(term.replace(/ /g, "-"))}?radius=0&action=facet_search`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("article[data-at='job-item'], .job-item"));
      return cards.map(card => {
        const titleEl = card.querySelector("[data-at='job-item-title'] a, h2 a");
        const orgEl = card.querySelector("[data-at='job-item-company-name'], .company");
        const locationEl = card.querySelector("[data-at='job-item-location'], .location");
        const salaryEl = card.querySelector("[data-at='job-item-salary'], .salary");
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
        id: slugify(j.title + "-cwjobs-" + j.url.slice(-10)),
        title: j.title,
        organisation: j.organisation,
        salary: j.salary,
        location: j.location,
        closing: "",
        url: j.url.startsWith("http") ? j.url : "https://www.cwjobs.co.uk" + j.url,
        source: "CWJobs",
        sponsorship: false,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`CWJobs failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeTechnoJobs(page, term) {
  const url = `https://www.technojobs.co.uk/search/it-jobs/?q=${encodeURIComponent(term)}&p=1`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".job, .job-result, article"));
      return cards.map(card => {
        const titleEl = card.querySelector("h2 a, h3 a, .job-title a");
        const orgEl = card.querySelector(".company, .employer");
        const locationEl = card.querySelector(".location, .job-location");
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

    return jobs
      .filter(j => j.title && j.url)
      .filter(j => meetsMinSalary(j.salary))
      .map(j => ({
        id: slugify(j.title + "-technojobs-" + j.url.slice(-10)),
        title: j.title,
        organisation: j.organisation,
        salary: j.salary,
        location: j.location,
        closing: "",
        url: j.url.startsWith("http") ? j.url : "https://www.technojobs.co.uk" + j.url,
        source: "TechnoJobs",
        sponsorship: false,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`TechnoJobs failed for "${term}": ${e.message}`);
    return [];
  }
}

async function scrapeCivilService(page, term) {
  const url = `https://www.civilservicejobs.service.gov.uk/csr/jobs.cgi?pageaction=searchbykey&term=${encodeURIComponent(term)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".search-results-job-box, .job-result"));
      return cards.map(card => {
        const titleEl = card.querySelector("h3 a, h2 a, .job-title a");
        const orgEl = card.querySelector(".dept, .organisation");
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

    return jobs
      .filter(j => j.title && j.url)
      .filter(j => meetsMinSalary(j.salary))
      .map(j => ({
        id: slugify(j.title + "-civilservice-" + j.url.slice(-10)),
        title: j.title,
        organisation: j.organisation,
        salary: j.salary,
        location: j.location,
        closing: "",
        url: j.url.startsWith("http") ? j.url : "https://www.civilservicejobs.service.gov.uk" + j.url,
        source: "Civil Service Jobs",
        sponsorship: false,
        found: new Date().toISOString().split("T")[0],
      }));
  } catch (e) {
    console.log(`Civil Service failed for "${term}": ${e.message}`);
    return [];
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
    { name: "Indeed", fn: scrapeIndeed },
    { name: "JobVisa UK", fn: scrapeJobVisa },
    { name: "CWJobs", fn: scrapeCWJobs },
    { name: "TechnoJobs", fn: scrapeTechnoJobs },
    { name: "Civil Service", fn: scrapeCivilService },
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

  await browser.close();

  const results = Array.from(allJobs.values());
  console.log(`\n✅ Total unique jobs: ${results.length}`);

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
