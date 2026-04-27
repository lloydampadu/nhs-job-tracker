import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const newJobsPath = path.join(__dirname, "../data/new-jobs.json");
let newJobs = [];
try {
  newJobs = JSON.parse(fs.readFileSync(newJobsPath, "utf-8"));
} catch {
  console.log("No new-jobs.json found");
  process.exit(0);
}

if (newJobs.length === 0) {
  console.log("No new jobs — skipping email");
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const sponsoredJobs = newJobs.filter(j => j.sponsorship);
const otherJobs = newJobs.filter(j => !j.sponsorship);

function jobRows(jobs) {
  return jobs.map(j => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:12px 8px;">
        <a href="${j.url}" style="color:#062350;font-weight:600;text-decoration:none;">${j.title}</a><br>
        <span style="color:#666;font-size:13px;">${j.organisation || "—"}</span>
      </td>
      <td style="padding:12px 8px;color:#444;font-size:13px;">${j.location || "—"}</td>
      <td style="padding:12px 8px;color:#f8981f;font-weight:600;font-size:13px;">${j.salary || "See listing"}</td>
      <td style="padding:12px 8px;font-size:13px;">
        <span style="background:${j.sponsorship ? "#e6f4ea" : "#f5f5f5"};color:${j.sponsorship ? "#1a8a4a" : "#666"};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">
          ${j.sponsorship ? "SPONSORS ✓" : j.source}
        </span>
      </td>
      <td style="padding:12px 8px;">
        <a href="${j.url}" style="background:#062350;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">Apply →</a>
      </td>
    </tr>
  `).join("");
}

const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f8f8f8;margin:0;padding:20px;">
  <div style="max-width:800px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#062350;padding:28px 32px;">
      <div style="color:#f8981f;font-weight:800;font-size:20px;letter-spacing:1px;">Lorabel Job Tracker</div>
      <div style="color:#fff;font-size:28px;font-weight:700;margin-top:6px;">
        ${newJobs.length} New Job${newJobs.length !== 1 ? "s" : ""} Found Today
      </div>
      <div style="color:rgba(255,255,255,0.6);font-size:14px;margin-top:4px;">
        ${new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      </div>
    </div>

    <div style="padding:24px 32px;">

      ${sponsoredJobs.length > 0 ? `
      <!-- Sponsored Jobs -->
      <div style="margin-bottom:28px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#1a8a4a;margin-bottom:12px;">
          🛂 Visa Sponsorship Available (${sponsoredJobs.length})
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#f8f8f8;">
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Role</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Location</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Salary</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Source</th>
              <th style="padding:8px;"></th>
            </tr>
          </thead>
          <tbody>${jobRows(sponsoredJobs)}</tbody>
        </table>
      </div>
      ` : ""}

      ${otherJobs.length > 0 ? `
      <!-- Other Jobs -->
      <div style="margin-bottom:28px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#666;margin-bottom:12px;">
          💼 Other Relevant Roles (${otherJobs.length}) — verify sponsorship on listing
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#f8f8f8;">
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Role</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Location</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Salary</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Source</th>
              <th style="padding:8px;"></th>
            </tr>
          </thead>
          <tbody>${jobRows(otherJobs)}</tbody>
        </table>
      </div>
      ` : ""}

      <!-- Footer -->
      <div style="border-top:1px solid #f0f0f0;padding-top:16px;color:#999;font-size:12px;">
        View all jobs on your dashboard →
        <a href="${process.env.DASHBOARD_URL || "https://nhs-job-tracker.vercel.app"}" style="color:#062350;font-weight:600;">
          ${process.env.DASHBOARD_URL || "nhs-job-tracker.vercel.app"}
        </a>
        <br>Minimum salary filter: £${(30000).toLocaleString()} · Sources: NHS Jobs, Indeed, JobVisa UK, CWJobs, TechnoJobs, Civil Service Jobs
      </div>
    </div>
  </div>
</body>
</html>
`;

await transporter.sendMail({
  from: `"Job Tracker" <${process.env.GMAIL_USER}>`,
  to: "lloydampadu18@gmail.com",
  subject: `🆕 ${newJobs.length} new job${newJobs.length !== 1 ? "s" : ""} found — ${new Date().toLocaleDateString("en-GB")}`,
  html,
});

console.log(`✅ Email sent with ${newJobs.length} new jobs`);
