import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  addAudit,
  getOrg,
  getOrCreateEmployeeReferralLink,
  getRequisition,
  listCandidates,
  listReferralPayouts,
  listRequisitions,
  listStageEvents,
  listUsers,
} from "@/lib/db";
import type { Requisition } from "@/lib/types";
import { referralEmail } from "@/lib/referrerIdentity";

const OPEN_STATUSES = new Set<Requisition["status"]>([
  "Approved",
  "Position Reopened",
  "Partially Fulfilled",
]);

function publicReferralStage(stage: string) {
  if (["PendingHMApproval", "New", "Social CV"].includes(stage)) return "Submitted";
  if (["Screened", "HMApproved"].includes(stage)) return "Screened";
  if (stage === "Shortlist") return "Shortlist";
  if (["Interview", "Interview Scheduled", "Debrief"].includes(stage)) return "Interview";
  if (stage === "Selected") return "Selected";
  if (["OfferApprovalPending", "OfferApproved", "Offered", "Onboarded"].includes(stage)) return "Offer stage";
  if (["Rejected", "Social CV Reject"].includes(stage)) return "Not selected";
  return null;
}

function isReferralTerminalStage(stage: string) {
  return ["Rejected", "Social CV Reject", "Offered", "Onboarded"].includes(stage);
}

async function requireReferralEmployee(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Employee") throw new ApiError(403, "This workspace is for Employee users.");
  if (!(await getOrg()).employeeReferralsEnabled) {
    throw new ApiError(403, "Employee Referrals is not enabled for this organization.");
  }
  return user;
}

export async function GET(request: Request) {
  try {
    const user = await requireReferralEmployee(request);
    const [requisitions, candidates, stageEvents, users, payouts, org] = await Promise.all([
      listRequisitions(),
      listCandidates(undefined, true),
      listStageEvents(),
      listUsers(true),
      listReferralPayouts(),
      getOrg(),
    ]);
    const allRequisitions = requisitions.map((requisition) => ({
      id: requisition.id,
      title: requisition.title,
      department: requisition.department,
      location: requisition.location,
      employment: requisition.employment,
      level: requisition.level,
      openings: requisition.openings,
      ...(org.referralShareSalary === true ? { salaryMin: requisition.salaryMin, salaryMax: requisition.salaryMax } : {}),
      jdText: requisition.jdText,
      referralBonus: requisition.referralBonus || 0,
      referralInterviewBonus: requisition.referralInterviewBonus || 0,
    }));
    const openRoles = requisitions
      .filter((requisition) => OPEN_STATUSES.has(requisition.status) && requisition.employeeReferralEnabled === true)
      .map((requisition) => allRequisitions.find((item) => item.id === requisition.id)!);
    const requisitionById = new Map(allRequisitions.map((requisition) => [requisition.id, requisition]));
    const referralCandidates = candidates.filter((candidate) => candidate.source === "Employee Referral");
    const employeeByEmail = new Map(users.map((member) => [member.email.toLowerCase(), member]));
    const leaderboardByEmail = new Map<string, { email: string; name: string; referralCount: number; bonusEarned: number }>();
    const joiningPayoutByCandidate = new Map(payouts
      .filter((payout) => payout.kind === "Joining")
      .map((payout) => [payout.candidateId, payout]));
    for (const member of users.filter((item) => item.role === "Employee")) {
      leaderboardByEmail.set(member.email.toLowerCase(), { email: member.email, name: member.name, referralCount: 0, bonusEarned: 0 });
    }
    for (const candidate of referralCandidates) {
      const email = referralEmail(candidate, users);
      if (!email) continue;
      const member = employeeByEmail.get(email);
      const entry = leaderboardByEmail.get(email) || {
        email,
        name: member?.name || email,
        referralCount: 0,
        bonusEarned: 0,
      };
      entry.referralCount += 1;
      if (candidate.stage === "Onboarded" && !joiningPayoutByCandidate.has(candidate.id)) {
        entry.bonusEarned += candidate.employeeReferralBonus ?? requisitionById.get(candidate.reqId)?.referralBonus ?? 0;
      }
      leaderboardByEmail.set(email, entry);
    }
    for (const payout of payouts) {
      const entry = leaderboardByEmail.get(payout.referrerEmail.toLowerCase());
      if (entry) entry.bonusEarned += payout.amount;
    }
    const leaderboard = [...leaderboardByEmail.values()]
      .sort((a, b) => b.referralCount - a.referralCount || b.bonusEarned - a.bonusEarned || a.name.localeCompare(b.name));

    const referrals = referralCandidates
      .filter((candidate) => referralEmail(candidate, users) === user.email.toLowerCase())
      .map((candidate) => {
        const requisition = requisitionById.get(candidate.reqId);
        const events = stageEvents
          .filter((event) => event.candidateId === candidate.id)
          .sort((a, b) => a.at.localeCompare(b.at));
        const history: { stage: string; at: string }[] = [];
        for (const event of events) {
          const stage = publicReferralStage(event.toStage);
          if (stage && history[history.length - 1]?.stage !== stage) history.push({ stage, at: event.at });
          if (isReferralTerminalStage(event.toStage)) break;
        }
        const visibleStage = publicReferralStage(candidate.stage) || "Submitted";
        const joiningPayout = joiningPayoutByCandidate.get(candidate.id);
        const visibleJoiningPayout = joiningPayout ? {
          ...joiningPayout,
          status: joiningPayout.status === "Paid"
            ? "Paid" as const
            : joiningPayout.dueAt && new Date(joiningPayout.dueAt).getTime() < Date.now()
              ? "Overdue" as const
              : "Pending" as const,
        } : undefined;
        const lastHistoryStage = history[history.length - 1]?.stage;
        if (lastHistoryStage !== visibleStage) {
          history.push({ stage: visibleStage, at: candidate.updatedAt || candidate.createdAt });
        }
        return {
          id: candidate.id,
          name: candidate.name,
          stage: visibleStage,
          createdAt: candidate.createdAt,
          reqId: candidate.reqId,
          requisitionTitle: requisition?.title || candidate.reqId,
          location: requisition?.location || "",
          referralBonus: joiningPayout?.amount ?? candidate.employeeReferralBonus ?? requisition?.referralBonus ?? 0,
          bonusEarned: candidate.stage === "Onboarded",
          joiningPayout: visibleJoiningPayout,
          interviewPayouts: payouts
            .filter((payout) => payout.candidateId === candidate.id && payout.kind !== "Joining")
            .sort((a, b) => a.roundIndex - b.roundIndex),
          history,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return json({ openRoles, referrals, leaderboard });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireReferralEmployee(request);
    const body = await request.json();
    const reqId = String(body.reqId || "").trim();
    if (!reqId) throw new ApiError(400, "Choose an open role to refer someone to.");
    const requisition = await getRequisition(reqId);
    if (!requisition || !OPEN_STATUSES.has(requisition.status) || requisition.employeeReferralEnabled !== true) {
      throw new ApiError(404, "This role is no longer open for referrals.");
    }

    const link = await getOrCreateEmployeeReferralLink(
      requisition.id,
      requisition.recruiterEmail || "",
      user.email,
      user.name,
      requisition.referralBonus || 0
    );
    await addAudit({
      action: "employee_referral.link.create",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "requisition",
      entityId: requisition.id,
      detail: `Employee referral link created by ${user.email}`,
    });
    return json({ token: link.token }, 201);
  } catch (error) {
    return errResponse(error);
  }
}
