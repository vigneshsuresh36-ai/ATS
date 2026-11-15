import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { canRecruit } from "@/lib/roles";
import { isCalendarEnabled } from "@/lib/calendarConfig";
import { getInterviewBusyPeriods } from "@/lib/googleCalendar";
import { isFreeInterval, type TimeRange } from "@/lib/calendarAvailability";

/** Free-busy placeholder — returns suggested slots without live Calendar when not configured. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canRecruit(user.role)) throw new ApiError(403, "Only recruiters and admins can check interview availability.");
    const body = await req.json();
    if (isCalendarEnabled() && Array.isArray(body.intervals)) {
      const emails = [...new Set(String(body.interviewers || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
      if (!emails.length || emails.length > 20 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError(400, "Enter up to 20 valid interviewer email addresses.");
      if (!body.intervals.length || body.intervals.length > 10) throw new ApiError(400, "Choose up to 10 proposed times.");
      const intervals: TimeRange[] = body.intervals.map((value: { start?: unknown; end?: unknown }) => ({ start: String(value?.start || ""), end: String(value?.end || "") }));
      const timestamps = intervals.flatMap((value) => [Date.parse(value.start), Date.parse(value.end)]);
      if (timestamps.some((value) => !Number.isFinite(value)) || intervals.some((value) => !isFreeInterval(value, []) || Date.parse(value.end) - Date.parse(value.start) > 8 * 3600000)) throw new ApiError(400, "Enter valid interview times of up to eight hours.");
      const min = Math.min(...timestamps), max = Math.max(...timestamps);
      if (max - min > 48 * 3600000) throw new ApiError(400, "Check times within a two-day window.");
      const busy = await getInterviewBusyPeriods(emails, new Date(min).toISOString(), new Date(max).toISOString());
      return json({ slots: intervals.filter((slot) => isFreeInterval(slot, busy)), note: "Checked interviewer calendars. Availability can change before an interview is booked." });
    }
    if (isCalendarEnabled()) throw new ApiError(400, "Provide proposed times and interviewer emails to check availability.");
    const date = String(body.date || new Date().toISOString().slice(0, 10));
    const slots = [10, 11, 14, 15, 16].map((h) => ({
      start: `${date}T${String(h).padStart(2, "0")}:00:00`,
      end: `${date}T${String(h + 1).padStart(2, "0")}:00:00`,
      available: true,
    }));
    return json({
      slots,
      note: "Live Google free-busy can be enabled later; showing suggested business hours.",
    });
  } catch (e) {
    return errResponse(e);
  }
}
