import { errResponse, json } from "@/lib/auth";
import { ensureJoiningDetails, listCandidates, listStageEvents, listUsers } from "@/lib/db";
import { listAccessibleJoiningRequisitions, requireOfferJoiningUser } from "@/lib/offerJoiningAccess";
import type { Candidate, JoiningStatus } from "@/lib/types";

const TERMINAL_STATUSES: JoiningStatus[] = ["Joined", "No-Show", "Candidate Withdrawn"];

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() + days);
  return date;
}

function isTerminalStage(stage: string) {
  return ["Rejected", "Candidate Backed Out", "Social CV Reject"].includes(stage);
}

function isActive(status: JoiningStatus, stage: string) {
  return !TERMINAL_STATUSES.includes(status) && !isTerminalStage(stage);
}

function normalizeJoiningCandidate(candidate: Candidate) {
  const initialDoj = candidate.initialDoj || candidate.tentativeDoj || "";
  return {
    ...candidate,
    initialDoj,
    currentDoj: candidate.currentDoj || initialDoj,
    joiningStatus: candidate.joiningStatus || (candidate.stage === "Onboarded" ? "Joined" : "Awaiting Confirmation"),
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireOfferJoiningUser(request);
    const dashboardOnly = new URL(request.url).searchParams.get("dashboard") === "1";
    const requisitions = await listAccessibleJoiningRequisitions(user);
    const requisitionById = new Map(requisitions.map((item) => [item.id, item]));
    const [allCandidates, events, users] = await Promise.all([listCandidates(), listStageEvents(), listUsers()]);
    const userByEmail = new Map(users.map((member) => [member.email.toLowerCase(), member]));
    const eligible = allCandidates.filter((candidate) =>
      requisitionById.has(candidate.reqId) &&
      (["Offered", "Onboarded"].includes(candidate.stage) || !!candidate.joiningStatus || !!candidate.initialDoj || !!candidate.currentDoj)
    );
    const initialized: (Candidate | null)[] = dashboardOnly
      ? eligible
      : await Promise.all(eligible.map((candidate) =>
        candidate.initialDoj && candidate.currentDoj && candidate.joiningStatus
          ? candidate
          : ensureJoiningDetails(candidate.id)
      ));
    const offerReleasedAt = new Map<string, string>();
    const joinedAt = new Map<string, string>();
    for (const event of events) {
      if (event.toStage === "Offered") {
        const existing = offerReleasedAt.get(event.candidateId);
        if (!existing || event.at < existing) offerReleasedAt.set(event.candidateId, event.at);
      }
      if (event.toStage === "Onboarded") {
        const existing = joinedAt.get(event.candidateId);
        if (!existing || event.at > existing) joinedAt.set(event.candidateId, event.at);
      }
    }
    const rows = initialized.filter((candidate): candidate is Candidate => !!candidate).map((candidate) => {
      const requisition = requisitionById.get(candidate.reqId)!;
      return {
        ...normalizeJoiningCandidate(candidate),
        requisitionTitle: requisition.title,
        department: requisition.department,
        requisitionLocation: requisition.location,
        recruiterEmail: requisition.recruiterEmail || "",
        recruiterName: requisition.recruiterEmail
          ? userByEmail.get(requisition.recruiterEmail.toLowerCase())?.name || requisition.recruiterEmail
          : "Unassigned",
        offerStatus: candidate.offerApprovalStatus || candidate.stage,
        offerReleasedAt: offerReleasedAt.get(candidate.id) || "",
        dojChangeCount: candidate.dojChangeCount || 0,
        isActive: candidate.offerApprovalStatus !== "Rejected" && isActive(candidate.joiningStatus || (candidate.stage === "Onboarded" ? "Joined" : "Awaiting Confirmation"), candidate.stage),
      };
    });

    const today = new Date();
    const todayKey = localDate(today);
    const weekStart = addDays(today, -((today.getDay() + 6) % 7));
    const weekEnd = addDays(weekStart, 7);
    const weekStartKey = localDate(weekStart);
    const weekEndKey = localDate(weekEnd);
    const nextWeekKey = localDate(addDays(today, 7));
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const activeRows = rows.filter((row) => row.isActive);
    const upcomingJoiners = activeRows
      .filter((row) => row.currentDoj >= todayKey && row.currentDoj < nextWeekKey)
      .sort((left, right) => left.currentDoj.localeCompare(right.currentDoj));

    return json({
      rows,
      upcomingJoiners,
      summary: {
        expectedJoiners: activeRows.length,
        joiningThisWeek: activeRows.filter((row) => row.currentDoj >= weekStartKey && row.currentDoj < weekEndKey).length,
        dojRescheduled: activeRows.filter((row) => row.dojChangeCount > 0).length,
        joinedThisMonth: rows.filter((row) => row.joiningStatus === "Joined" && (row.joiningStatusUpdatedAt?.startsWith(monthKey) || row.actualJoiningDate?.startsWith(monthKey) || joinedAt.get(row.id)?.startsWith(monthKey))).length,
        noShows: rows.filter((row) => row.joiningStatus === "No-Show").length,
      },
    });
  } catch (error) {
    return errResponse(error);
  }
}