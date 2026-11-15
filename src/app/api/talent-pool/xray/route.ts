import { NextRequest } from "next/server";
import { aiConfigured, generateAI, reserveAIUsage } from "@/lib/ai";
import { assistantRequisitions } from "@/lib/assistantAccess";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { getRequisition, listUsers } from "@/lib/db";

export const runtime = "nodejs";

const OPEN_STATUSES = ["Approved", "Position Reopened", "Partially Fulfilled"];
const GITHUB_NON_PROFILES = new Set(["about", "collections", "enterprise", "events", "explore", "features", "login", "marketplace", "pricing", "search", "signup", "sponsors", "topics", "trending"]);

function searchTerms(value: string, maxLength: number) {
  return value.replace(/[^\p{L}\p{M}\p{N} .+#/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function profileUrl(value: string, site: "linkedin" | "github") {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (site === "linkedin") {
      if (!/(^|\.)linkedin\.com$/.test(url.hostname) || !/^\/in\/[^/]+\/?$/.test(url.pathname)) return null;
      url.hostname = "www.linkedin.com";
    } else {
      const username = url.pathname.replace(/^\/|\/$/g, "");
      if (url.hostname !== "github.com" || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(username) || GITHUB_NON_PROFILES.has(username.toLowerCase())) return null;
    }
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.href;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Only admins and recruiters can use X-ray Search.");

    const body = await request.json().catch(() => null);
    const site = body?.site;
    const requisitionId = body?.requisitionId;
    if ((site !== "linkedin" && site !== "github") || typeof requisitionId !== "string" || !requisitionId.trim() || requisitionId.length > 200 || requisitionId.includes("/")) {
      throw new ApiError(400, "Choose an open position and search site.");
    }

    const position = await getRequisition(requisitionId);
    if (!position || !OPEN_STATUSES.includes(position.status) || !assistantRequisitions(user, [position], user.role === "Admin" ? await listUsers() : []).length) {
      throw new ApiError(404, "This open position is unavailable in your workspace.");
    }

    const title = searchTerms(position.title, 100);
    const location = searchTerms(position.location || "", 80);
    if (!title) throw new ApiError(400, "This position needs a job title before it can be searched.");

    const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
    const useAi = aiConfigured();
    if (key || useAi) await reserveAIUsage(user.email);
    let terms = title;
    if (useAi) {
      try {
        const suggestion = await generateAI(
          "Return a short, plain-text public web search phrase for this job title. Use the title or a common equivalent. Keep it to eight words or fewer. Do not include names, contact details, search operators, or commentary.",
          { title },
          false,
          8000,
        );
        terms = searchTerms(suggestion, 100) || title;
      } catch {
        // The position still provides a usable query when AI is unavailable.
      }
    }

    const domain = site === "linkedin" ? "linkedin.com" : "github.com";
    const keywords = [terms, location].filter(Boolean).join(" ");
    const googleQuery = `site:${site === "linkedin" ? "linkedin.com/in" : domain} ${keywords}`;
    const googleUrl = `https://www.google.com/search?${new URLSearchParams({ q: googleQuery })}`;
    if (!key) return json({ googleUrl, results: [], notice: "In-app results need a connected search provider. You can open this position’s search on Google." });

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({
      q: `site:${domain} ${keywords}`,
      count: "20",
      result_filter: "web",
      text_decorations: "false",
    }).toString();

    try {
      const response = await fetch(url, {
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Search provider rejected the request");
      const data = await response.json() as { web?: { results?: { title: string; description?: string; url: string }[] } };
      const results = new Map<string, { title: string; description: string; url: string }>();
      for (const entry of data.web?.results || []) {
        if (typeof entry?.url !== "string" || typeof entry.title !== "string") continue;
        const link = profileUrl(entry.url, site);
        if (!link || results.has(link)) continue;
        results.set(link, { title: entry.title.slice(0, 220), description: typeof entry.description === "string" ? entry.description.slice(0, 450) : "", url: link });
        if (results.size === 10) break;
      }
      return json({ googleUrl, results: [...results.values()] });
    } catch {
      return json({ googleUrl, results: [], notice: "In-app search is temporarily unavailable. Try again or open the search on Google." });
    }
  } catch (error) {
    return errResponse(error);
  }
}
