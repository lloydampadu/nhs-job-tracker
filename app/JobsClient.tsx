"use client";

import { useState, useMemo } from "react";
import type { Job } from "./page";

const SOURCES = ["All", "NHS Jobs", "JobVisa UK", "UN Jobs", "Devex", "ReliefWeb", "Idealist", "Work In Startups", "F6S", "Healthcare Jobs UK", "Digital Health Jobs"];

export default function JobsClient({ jobs }: { jobs: Job[] }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("All");
  const [sponsorOnly, setSponsorOnly] = useState(false);
  const [sort, setSort] = useState<"found" | "salary" | "priority">("priority");

  const filtered = useMemo(() => {
    let result = [...jobs];
    if (sponsorOnly) result = result.filter(j => j.sponsorship);
    if (source !== "All") result = result.filter(j => j.source === source);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j =>
        j.title.toLowerCase().includes(q) ||
        j.organisation.toLowerCase().includes(q) ||
        j.location.toLowerCase().includes(q)
      );
    }
    if (sort === "salary") {
      result.sort((a, b) => {
        const sa = parseInt(a.salary.replace(/[^0-9]/g, "") || "0");
        const sb = parseInt(b.salary.replace(/[^0-9]/g, "") || "0");
        return sb - sa;
      });
    } else if (sort === "found") {
      result.sort((a, b) => b.found.localeCompare(a.found));
    } else {
      // priority (default)
      result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
    return result;
  }, [jobs, search, source, sponsorOnly, sort]);

  const sponsorCount = jobs.filter(j => j.sponsorship).length;
  const todayCount = jobs.filter(j => j.found === new Date().toISOString().split("T")[0]).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#062350] text-white px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-[#f8981f] font-bold text-sm tracking-widest uppercase mb-1">Lorabel</div>
          <h1 className="text-3xl font-bold">Job Tracker</h1>
          <p className="text-white/60 text-sm mt-1">UK tech jobs with visa sponsorship — updated daily</p>
          <div className="flex gap-6 mt-5">
            <div>
              <div className="text-2xl font-bold text-[#f8981f]">{jobs.length}</div>
              <div className="text-white/60 text-xs uppercase tracking-wide">Total Jobs</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-400">{sponsorCount}</div>
              <div className="text-white/60 text-xs uppercase tracking-wide">With Sponsorship</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{todayCount}</div>
              <div className="text-white/60 text-xs uppercase tracking-wide">Added Today</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{filtered.length}</div>
              <div className="text-white/60 text-xs uppercase tracking-wide">Showing</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search title, company, location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-4 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-[#062350]"
          />
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062350]"
          >
            {SOURCES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as "found" | "salary")}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062350]"
          >
            <option value="priority">Best match first</option>
            <option value="found">Newest first</option>
            <option value="salary">Highest salary</option>
          </select>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={sponsorOnly}
              onChange={e => setSponsorOnly(e.target.checked)}
              className="accent-[#062350]"
            />
            <span className="text-green-700 font-semibold">Sponsorship only</span>
          </label>
        </div>
      </div>

      {/* Jobs List */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <div className="text-4xl mb-3">🔍</div>
            <div className="font-medium">No jobs match your filters</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(job => (
              <div key={job.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:border-[#062350]/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {job.sponsorship && (
                        <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">SPONSORS ✓</span>
                      )}
                      <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{job.source}</span>
                      {(job.priority ?? 0) >= 90 && (
                        <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">🔥 TOP MATCH</span>
                      )}
                      {job.found === new Date().toISOString().split("T")[0] && (
                        <span className="bg-[#f8981f]/10 text-[#f8981f] text-xs font-bold px-2 py-0.5 rounded-full">NEW TODAY</span>
                      )}
                    </div>
                    <a href={job.url} target="_blank" rel="noopener noreferrer"
                      className="text-[#062350] font-semibold text-lg hover:underline">
                      {job.title}
                    </a>
                    <div className="text-gray-500 text-sm mt-0.5">{job.organisation}</div>
                    <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-600">
                      {job.location && <span>📍 {job.location}</span>}
                      {job.salary && <span className="text-[#f8981f] font-semibold">💷 {job.salary}</span>}
                      {job.closing && <span>📅 Closes {job.closing}</span>}
                    </div>
                    {job.snippet && (
                      <p className="text-gray-500 text-sm mt-2 line-clamp-2">{job.snippet}</p>
                    )}
                    {job.dealBreakers && job.dealBreakers.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="text-xs text-red-500 font-semibold">⚠️ Requirements to check:</span>
                        {job.dealBreakers.slice(0, 4).map(d => (
                          <span key={d} className="bg-red-50 text-red-500 text-xs px-2 py-0.5 rounded-full">{d}</span>
                        ))}
                      </div>
                    )}
                    {job.greenFlags && job.greenFlags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="text-xs text-green-600 font-semibold">✓ Your skills match:</span>
                        {job.greenFlags.slice(0, 5).map(g => (
                          <span key={g} className="bg-green-50 text-green-600 text-xs px-2 py-0.5 rounded-full">{g}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <a href={job.url} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 bg-[#062350] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0a3580] transition-colors whitespace-nowrap">
                    Apply →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
