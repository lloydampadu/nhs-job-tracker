import fs from "fs";
import path from "path";
import JobsClient from "./JobsClient";

export const revalidate = 3600;

export type Job = {
  id: string;
  title: string;
  organisation: string;
  salary: string;
  location: string;
  closing: string;
  url: string;
  source: string;
  sponsorship: boolean;
  found: string;
  priority?: number;
  snippet?: string;
  dealBreakers?: string[];
  greenFlags?: string[];
  noSponsorship?: boolean;
  detailScraped?: boolean;
};

export default function Home() {
  let jobs: Job[] = [];
  try {
    const dataPath = path.join(process.cwd(), "data/jobs.json");
    jobs = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch {}

  return <JobsClient jobs={jobs} />;
}
