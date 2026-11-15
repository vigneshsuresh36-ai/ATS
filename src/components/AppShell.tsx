"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { WorkspaceIcon } from "@/components/ats/WorkspaceIcon";
import { HiringAssistant } from "@/components/ats/HiringAssistant";
import { HelpMenu } from "@/components/ats/HelpMenu";
import { SupportTicketsView } from "@/components/ats/SupportTicketsView";
import { JobDescriptionPage } from "@/components/ats/JobDescriptionPage";
import { PipelinePanel } from "@/components/ats/PipelinePanel";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AuthBootScreen, useAuth } from "@/components/AuthProvider";
import { DEPARTMENTS } from "@/lib/roles";
import { ini } from "@/components/ats/ui";
import { signalHoneyBadgerMood } from "@/lib/honeyBadgerMood";
import type { OrgSettings } from "@/lib/types";
import type {
  AppNotification,
  AppUser,
  ApprovalStatus,
  Candidate,
  Requisition,
  Role,
} from "@/lib/types";

const TodayView = dynamic(
  () => import("@/components/ats/TodayView").then((m) => m.TodayView),
  { ssr: false }
);
const RecruitmentHeadOverview = dynamic(() => import("@/components/ats/RecruitmentHeadOverview").then((m) => m.RecruitmentHeadOverview), { ssr: false });
const AutomationsView = dynamic(
  () => import("@/components/ats/AutomationsView").then((m) => m.AutomationsView),
  { ssr: false, loading: () => <p role="status">Loading automations…</p> }
);
const ReqBoard = dynamic(
  () => import("@/components/ats/ReqBoard").then((m) => m.ReqBoard),
  { ssr: false }
);
const StatusAuditReport = dynamic(() => import("@/components/ats/StatusAuditReport").then((module) => module.StatusAuditReport));
const ApprovalsView = dynamic(
  () => import("@/components/ats/ApprovalsView").then((m) => m.ApprovalsView),
  { ssr: false }
);
const ScheduleView = dynamic(
  () => import("@/components/ats/ScheduleView").then((m) => m.ScheduleView),
  { ssr: false }
);
const AnalyticsView = dynamic(
  () => import("@/components/ats/AnalyticsView").then((m) => m.AnalyticsView),
  { ssr: false }
);
const RecruiterDashboard = dynamic(
  () => import("@/components/ats/RecruiterDashboard").then((m) => m.RecruiterDashboard),
  { ssr: false }
);
const DepartmentHeadDashboard = dynamic(
  () => import("@/components/ats/DepartmentHeadDashboard").then((m) => m.DepartmentHeadDashboard),
  { ssr: false }
);
const HiringManagerDashboard = dynamic(
  () => import("@/components/ats/HiringManagerDashboard").then((m) => m.HiringManagerDashboard),
  { ssr: false }
);
const TeamView = dynamic(
  () => import("@/components/ats/TeamView").then((m) => m.TeamView),
  { ssr: false }
);
const TalentPoolView = dynamic(
  () => import("@/components/ats/TalentPoolView").then((m) => m.TalentPoolView),
  { ssr: false }
);
const OfferJoiningView = dynamic(
  () => import("@/components/ats/OfferJoiningView").then((m) => m.OfferJoiningView),
  { ssr: false }
);
const VendorsSpendView = dynamic(
  () => import("@/components/ats/VendorsSpendView").then((m) => m.VendorsSpendView),
  { ssr: false }
);
const AdminSettingsView = dynamic(
  () => import("@/components/ats/AdminSettingsView").then((m) => m.AdminSettingsView),
  { ssr: false }
);
const ReportsView = dynamic(
  () => import("@/components/ats/ReportsView").then((m) => m.ReportsView),
  { ssr: false }
);
const EmployeeReferralsView = dynamic(
  () => import("@/components/ats/EmployeeReferralsView").then((m) => m.EmployeeReferralsView),
  { ssr: false }
);

type Tab =
  | "automations"
  | "requisitions"
  | "approvals"
  | "schedule"
  | "dashboard"
  | "settings"
  | "reports"
  | "talent-pool"
  | "offer-joining"
  | "vendors-spend"
  | "support-tickets"
  | "referrals";

export default function AppShell({ jobDescriptionId, initialRoleId, hiringRequests = false }: { jobDescriptionId?: string; initialRoleId?: string; hiringRequests?: boolean }) {
  const { profile, loading, token, apiFetch, signOut, error, actingAsEmail, startActingAs, stopActingAs } = useAuth();
  const router = useRouter();
  const [tab, updateTab] = useState<Tab>(jobDescriptionId || initialRoleId || hiringRequests ? "requisitions" : "dashboard");
  const [showJobDescription, setShowJobDescription] = useState(!!jobDescriptionId);
  const setTab = useCallback((next: Tab) => {
    setShowJobDescription(false);
    updateTab(next);
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [referralSection, setReferralSection] = useState<"leaderboard" | "roles" | "referrals">("leaderboard");
  const [settingsSection, setSettingsSection] = useState<"company" | "teams" | "workflow" | "addons" | "modules" | "integrations">("company");
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [overlay, setOverlay] = useState(false);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const notificationsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) notificationsRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && notificationsRef.current?.open) {
        notificationsRef.current.open = false;
        notificationsRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, []);
  const [panel, setPanel] = useState<ReactNode>(null);
  const [candidatePage, setCandidatePage] = useState(false);
  const [pipelinePanel, setPipelinePanel] = useState<ReactNode>(null);
  const panelDismiss = useRef<(() => void) | null>(null);
  const [today, setToday] = useState<Record<string, unknown> | null>(null);
  const [reqs, setReqs] = useState<Requisition[]>([]);
  const [approvals, setApprovals] = useState<Requisition[]>([]);
  const [notificationItems, setNotificationItems] = useState<AppNotification[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [offerApprovals, setOfferApprovals] = useState<
    { candidate: Candidate; requisition: Requisition | null }[]
  >([]);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(
    null
  );
  const [offerJoiningData, setOfferJoiningData] = useState<Record<string, unknown> | null>(null);
  const [vendorsSpendData, setVendorsSpendData] = useState<Record<string, unknown> | null>(null);
  const [team, setTeam] = useState<AppUser[]>([]);
  const [teamDepartments, setTeamDepartments] = useState<string[]>([...DEPARTMENTS]);
  const [teamDepartmentDetails, setTeamDepartmentDetails] = useState<{ name: string; userCount: number; requisitionCount: number; inUse: boolean }[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [schedulePrefill, setSchedulePrefill] = useState<{
    reqId: string;
    candidateId: string;
    roundIndex: number;
  } | null>(null);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("ats-sidebar-collapsed") === "true");
  }, []);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (accountMenuRef.current?.open && event.target instanceof Node && !accountMenuRef.current.contains(event.target)) {
        accountMenuRef.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && accountMenuRef.current?.open) {
        accountMenuRef.current.open = false;
        accountMenuRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const role = profile?.role as Role | undefined;

  const updateReqStatus = useCallback(
    async (id: string, status: ApprovalStatus, reason: string) => {
      const response = await apiFetch(`/api/requisitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update status.");
      const updated = data.requisition as Requisition;
      setReqs((current) =>
        current.map((req) => (req.id === updated.id ? updated : req))
      );
      setMsg(`Status updated to ${status}.`);
      return updated;
    },
    [apiFetch]
  );

  const updateReqPriority = useCallback(
    async (id: string, priorityLevel: string) => {
      const response = await apiFetch(`/api/requisitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorityLevel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update priority.");
      const updated = data.requisition as Requisition;
      setReqs((current) => current.map((req) => (req.id === updated.id ? updated : req)));
      setMsg(`Priority updated to ${priorityLevel}.`);
      return updated;
    },
    [apiFetch]
  );

  useEffect(() => {
    if (!loading && (!token || !profile)) router.replace("/login");
  }, [loading, token, profile, router]);

  const loadToday = useCallback(async () => {
    const r = await apiFetch("/api/today");
    const d = await r.json();
    if (r.ok) setToday(d);
  }, [apiFetch]);

  const loadReqs = useCallback(async () => {
    const r = await apiFetch("/api/requisitions");
    const d = await r.json();
    if (r.ok) setReqs(d.requisitions || []);
  }, [apiFetch]);

  const loadApprovals = useCallback(async () => {
    const r = await apiFetch("/api/approvals");
    const d = await r.json();
    if (r.ok) {
      setApprovals(d.requisitions || []);
      setOfferApprovals(d.offerApprovals || []);
    }
  }, [apiFetch]);

  const loadNotifications = useCallback(async () => {
    const response = await apiFetch("/api/notifications");
    const data = await response.json();
    if (response.ok) {
      setNotificationItems(data.notifications || []);
      setNotificationUnreadCount(data.unreadCount || 0);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!profile || role === "Employee") return;
    void loadNotifications();
    const interval = window.setInterval(() => void loadNotifications(), 60_000);
    return () => window.clearInterval(interval);
  }, [profile, role, loadNotifications]);

  async function markAllNotificationsRead() {
    const response = await apiFetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    if (!response.ok) return;
    const readAt = new Date().toISOString();
    setNotificationItems((current) => current.map((item) => ({ ...item, readAt })));
    setNotificationUnreadCount(0);
  }

  async function openNotification(notification: AppNotification) {
    if (!notification.readAt) {
      const response = await apiFetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
      });
      if (response.ok) {
        const readAt = new Date().toISOString();
        setNotificationItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
        setNotificationUnreadCount((current) => Math.max(0, current - 1));
      }
    }
    if (notificationsRef.current) notificationsRef.current.open = false;
    setTab(notification.type === "requisition-submitted" ? "approvals" : "requisitions");
  }

  const loadAnalytics = useCallback(async () => {
    const r = await apiFetch("/api/analytics");
    const d = await r.json();
    if (r.ok) setAnalytics(d);
  }, [apiFetch]);

  const loadOfferJoining = useCallback(async (dashboardOnly = false) => {
    const response = await apiFetch(`/api/offer-joining${dashboardOnly ? "?dashboard=1" : ""}`);
    const data = await response.json();
    if (response.ok) setOfferJoiningData(data);
  }, [apiFetch]);

  const loadVendorsSpend = useCallback(async () => {
    const response = await apiFetch("/api/vendors-spend");
    const data = await response.json();
    if (response.ok) setVendorsSpendData(data);
  }, [apiFetch]);

  const loadTeam = useCallback(async () => {
    const r = await apiFetch("/api/team");
    const d = await r.json();
    if (r.ok) {
      setTeam(d.users || []);
      setTeamDepartments(d.departments || [...DEPARTMENTS]);
      setTeamDepartmentDetails(d.departmentDetails || []);
      const customDepartments = (d.departments || [...DEPARTMENTS]).filter(
        (department: string) => !DEPARTMENTS.some((builtIn) => builtIn.toLowerCase() === department.toLowerCase())
      );
      setOrgSettings((current) => current ? { ...current, customDepartments } : current);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!profile) return;
    apiFetch("/api/org")
      .then((r) => r.json())
      .then((d) => {
        if (d.org) {
          setOrgSettings(d.org as OrgSettings);
          if (role === "Employee") setTab("referrals");
        }
      });
    if (!jobDescriptionId && !initialRoleId && !hiringRequests) setTab("dashboard");
  }, [profile, apiFetch, role, jobDescriptionId, initialRoleId, hiringRequests, setTab]);

  useEffect(() => {
    if (!profile) return;
    if (role === "Employee") return;
    if (tab === "dashboard") {
      loadToday();
      loadAnalytics();
      loadReqs();
      if (role === "Recruiter" || role === "DepartmentHead" || role === "HiringManager") loadApprovals();
      if (role === "Admin") {
        loadTeam();
        loadApprovals();
      }
    }
    if (tab === "requisitions") loadReqs();
    if (tab === "talent-pool") loadReqs();
    if (tab === "reports" && role === "Admin") loadAnalytics();
    if (tab === "approvals") loadApprovals();
    if (tab === "settings" && role === "Admin") loadTeam();
    if (tab === "schedule") {
      loadReqs();
      loadToday();
    }
  }, [
    tab,
    profile,
    loadToday,
    loadReqs,
    loadApprovals,
    loadAnalytics,
    loadTeam,
    role,
  ]);

  useEffect(() => {
    if (!profile || !orgSettings?.offerJoiningEnabled || (role !== "Admin" && role !== "Recruiter")) {
      setOfferJoiningData(null);
      if (tab === "offer-joining") setTab("dashboard");
      return;
    }
    if (tab === "dashboard") void loadOfferJoining(true);
    else if (tab === "offer-joining") void loadOfferJoining();
  }, [tab, profile, role, orgSettings?.offerJoiningEnabled, loadOfferJoining, setTab]);

  useEffect(() => {
    if (!profile || !orgSettings?.vendorsSpendEnabled || (role !== "Admin" && role !== "Recruiter")) {
      setVendorsSpendData(null);
      if (tab === "vendors-spend") setTab("dashboard");
      return;
    }
    if (tab === "vendors-spend") void loadVendorsSpend();
  }, [tab, profile, role, orgSettings?.vendorsSpendEnabled, loadVendorsSpend, setTab]);

  const tabs = useMemo(() => {
    if (role === "Employee") {
      return orgSettings?.employeeReferralsEnabled
        ? [{ id: "referrals" as const, label: "Employee Referrals", show: true }]
        : [];
    }
    const all: { id: Tab; label: string; show: boolean }[] = [
      { id: "dashboard", label: "Overview", show: true },
      { id: "requisitions", label: "Hiring Requests", show: true },
      { id: "schedule", label: "Interviews", show: true },
      { id: "approvals", label: "Approvals", show: true },
      { id: "offer-joining", label: "Offer & Joining", show: (role === "Admin" || role === "Recruiter") && orgSettings?.offerJoiningEnabled === true },
      { id: "talent-pool", label: "Talent Pool", show: role === "Admin" || role === "Recruiter" },
      { id: "automations", label: "Automations", show: role === "Admin" || role === "Recruiter" },
      { id: "reports", label: "Reports", show: role === "Admin" },
      { id: "vendors-spend", label: "Vendors & Spend", show: (role === "Admin" || role === "Recruiter") && orgSettings?.vendorsSpendEnabled === true },
      { id: "settings", label: "Settings", show: role === "Admin" },
      { id: "support-tickets", label: "Support Tickets", show: role === "Admin" },
    ];
    return all.filter((t) => t.show);
  }, [orgSettings?.employeeReferralsEnabled, orgSettings?.offerJoiningEnabled, orgSettings?.vendorsSpendEnabled, role]);

  function openModal(node: ReactNode, onDismiss?: () => void, preservePipeline = false) {
    setCandidatePage(false);
    panelDismiss.current = onDismiss || null;
    if (!preservePipeline) setPipelinePanel(null);
    setPanel(node);
    setOverlay(true);
  }
  function closeModal() {
    setCandidatePage(false);
    panelDismiss.current = null;
    setOverlay(false);
    setPanel(null);
    setPipelinePanel(null);
  }

  function dismissModal() {
    if (panelDismiss.current) panelDismiss.current();
    else closeModal();
  }

  async function openCandidate(id: string, returnReqId?: string) {
    const [{ CandidatePanel }, r] = await Promise.all([
      import("@/components/ats/CandidatePanel"),
      apiFetch(`/api/candidates/${id}`),
    ]);
    const d = await r.json();
    if (!r.ok) {
      setMsg(d.error);
      return;
    }
    const cand = d.candidate as { reqId: string };
    const reqMeta = reqs.find((x) => x.id === cand.reqId);
    const isHmOwner =
      !!profile?.email &&
      !!reqMeta &&
      reqMeta.raisedByEmail === profile.email.toLowerCase();
    // If req not in list, fetch for ownership check
    let hmOwner = isHmOwner;
    if (!reqMeta && role === "HiringManager") {
      const rr = await apiFetch(`/api/requisitions/${cand.reqId}`);
      const rd = await rr.json();
      if (rr.ok) {
        hmOwner =
          rd.requisition.raisedByEmail === profile!.email.toLowerCase();
      }
    }
    const closeCandidate = returnReqId ? () => { void openPipeline(returnReqId); } : closeModal;
    openModal(
      <CandidatePanel
        key={id}
        data={d}
        role={role!}
        org={orgSettings}
        isHmOwner={hmOwner || role === "Admin"}
        onClose={closeCandidate}
        apiFetch={apiFetch}
        onRefresh={() => openCandidate(id, returnReqId)}
        onOpenApplication={(applicationRecordId) => openCandidate(applicationRecordId, returnReqId)}
        onScheduleRound={(roundIndex) => {
          closeModal();
          setSchedulePrefill({
            reqId: cand.reqId,
            candidateId: id,
            roundIndex,
          });
          setTab("schedule");
        }}
      />,
      closeCandidate,
      !!returnReqId
    );
    setCandidatePage(true);
    setOverlay(false);
  }

  async function openPipeline(reqId: string, showDetails = false) {
    setCandidatePage(false);
    const encodedId = encodeURIComponent(reqId);
    const [rr, cr, ir, pr, teamResponse] = await Promise.all([
      apiFetch(`/api/requisitions/${encodedId}`),
      apiFetch(`/api/candidates?reqId=${encodedId}`),
      apiFetch(`/api/schedule?reqId=${encodedId}`),
      apiFetch(`/api/requisitions/${encodedId}/plan`),
      showDetails && role === "Admin" && !team.length ? apiFetch("/api/team").catch(() => null) : null,
    ]);
    const rd = await rr.json();
    const cd = await cr.json();
    const idata = await ir.json();
    const pdata = await pr.json();
    if (!rr.ok) {
      setMsg(rd.error || "Failed to load requisition.");
      return;
    }
    const roleTeam: AppUser[] = teamResponse?.ok ? (await teamResponse.json()).users || [] : team;
    if (teamResponse?.ok) setTeam(roleTeam);
    setPipelinePanel(
      <PipelinePanel
        key={reqId}
        initialDetailsPage={showDetails}
        req={rd.requisition}
        candidates={cd.candidates || []}
        interviews={idata.interviews || []}
        plan={pdata.plan || null}
        org={orgSettings}
        recruiters={roleTeam.filter((member) => member.role === "Recruiter" && member.managerEmail === profile?.email?.toLowerCase())}
        role={role!}
        profileEmail={profile?.email}
        onClose={closeModal}
        apiFetch={apiFetch}
        onRefresh={() => openPipeline(reqId, showDetails)}
        onCand={(candidateId) => { void openCandidate(candidateId, reqId); }}
        onAddCandidate={() => openAddCandidate(reqId, rd.requisition.title)}
        onScheduleCandidate={(candidateId, roundIndex) => {
          closeModal();
          setSchedulePrefill({ reqId, candidateId, roundIndex });
          setTab("schedule");
        }}
      />
    );
    panelDismiss.current = null;
    setPanel(null);
    setOverlay(true);
  }

  const openedRoleDetails = useRef<string | null>(null);
  useEffect(() => {
    if (!initialRoleId || !profile || profile.role === "Employee" || openedRoleDetails.current === initialRoleId) return;
    openedRoleDetails.current = initialRoleId;
    void openPipeline(initialRoleId, true).catch(() => setMsg("Failed to load requisition."));
  }, [initialRoleId, profile, openPipeline]);

  async function openAddCandidate(reqId: string, reqTitle: string) {
    const { AddCandidateModal } = await import(
      "@/components/ats/AddCandidateModal"
    );
    const returnToPosition = () => {
      panelDismiss.current = null;
      setPanel(null);
    };
    openModal(
      <AddCandidateModal
        reqId={reqId}
        reqTitle={reqTitle}
        apiFetch={apiFetch}
        onClose={returnToPosition}
        onBack={returnToPosition}
        onSaved={() => {
          setMsg("Candidate added.");
          openPipeline(reqId);
        }}
        vendorsSpendEnabled={orgSettings?.vendorsSpendEnabled === true}
      />,
      returnToPosition,
      true
    );
  }

  async function doSearch() {
    if (searchQ.trim().length < 2) return;
    const [{ SearchPanel }, r] = await Promise.all([
      import("@/components/ats/SearchPanel"),
      apiFetch(`/api/search?q=${encodeURIComponent(searchQ)}`),
    ]);
    const d = await r.json();
    if (r.ok) {
      openModal(
        <SearchPanel
          data={d}
          onClose={closeModal}
          onReq={(id) => {
            closeModal();
            openPipeline(id);
          }}
          onCand={(id) => {
            closeModal();
            openCandidate(id);
          }}
        />
      );
    }
  }

  async function openNewReq() {
    const { NewReqForm } = await import("@/components/ats/NewReqForm");
    openModal(
      <NewReqForm
        apiFetch={apiFetch}
        raisedBy={`${profile?.name} · ${profile?.email}`}
        officeLocations={orgSettings?.officeLocations}
        businessUnits={orgSettings?.businessUnits}
        organization={orgSettings}
        accessScopes={role === "HiringManager" ? profile?.accessScopes : undefined}
        subDepartments={orgSettings?.subDepartments}
        departmentRequired={orgSettings?.requisitionDepartmentRequired !== false}
        businessUnitRequired={orgSettings?.requisitionBusinessUnitRequired === true || !!orgSettings?.businessUnits?.length}
        allowedDepartments={
          role === "Admin"
            ? [...new Set([...DEPARTMENTS, ...(orgSettings?.customDepartments || [])])]
            : profile?.departments?.length
              ? profile.departments
              : [...new Set([...DEPARTMENTS, ...(orgSettings?.customDepartments || [])])]
        }
        onClose={closeModal}
        onSave={async (body) => {
          const r = await apiFetch("/api/requisitions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const d = await r.json();
          if (!r.ok) {
            setMsg(d.error || "Failed");
            return;
          }
          setMsg(
            `Requisition ${d.requisition.id} sent to ${d.requisition.department ? `${d.requisition.department} department head(s)` : "Admins"} for approval.`
          );
          closeModal();
          setTab("requisitions");
          loadReqs();
        }}
      />
    );
  }

  if (loading || !profile) {
    return (
      <AuthBootScreen
        message="Loading workspace"
        detail="Pulling in your requisitions and pipeline…"
      />
    );
  }

  const firstName = profile.name?.trim().split(/\s+/)[0] || "there";
  const dashboardGreeting = (() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return `Good morning, ${firstName}`;
    if (hour >= 12 && hour < 17) return `Good noon, ${firstName}`;
    return `Good evening, ${firstName}`;
  })();
  const pendingApprovalCount = approvals.filter((item) => item.status === "PendingApproval").length +
    offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length;
  const pageHeading = (
    <div className={`ats-page-heading${tab === "talent-pool" || tab === "automations" || (tab === "approvals" && (role === "Admin" || role === "DepartmentHead")) ? " ats-page-heading-hidden" : ""}`}>
      <div>
        <span className="ats-page-eyebrow">{orgSettings?.company || "Talent Acquisition"}</span>
        <h1 className="ats-heading-primary" style={{ fontFamily: 'Calibri, "Segoe UI", sans-serif' }}>
          {role === "Employee" ? "Employee Referrals" : tab === "dashboard" ? dashboardGreeting : tabs.find((item) => item.id === tab)?.label || "Dashboard"}
        </h1>
      </div>
      {(role === "HiringManager" || role === "Admin") && tab === "requisitions" && (
        <button type="button" className="ats-primary-button ats-heading-new-req" onClick={openNewReq}>
          <span aria-hidden="true">＋</span> New requisition
        </button>
      )}
    </div>
  );

  return (
    <div className={`ats-app-shell premium-workspace${sidebarCollapsed ? " ats-sidebar-collapsed" : ""}`}>
      <aside className="ats-sidebar">
        <div className="ats-brand">
          <span className="ats-sidebar-heading">ATS - Project Z</span>
          <button
            type="button"
            className="ats-sidebar-toggle"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-controls="ats-main-navigation"
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => {
              const next = !sidebarCollapsed;
              setSidebarCollapsed(next);
              window.localStorage.setItem("ats-sidebar-collapsed", String(next));
            }}
          >
            <WorkspaceIcon name="arrow" size={16} style={{ transform: sidebarCollapsed ? "none" : "rotate(180deg)" }} />
          </button>
        </div>
        <nav id="ats-main-navigation" className="ats-side-nav" aria-label="Main navigation">
          {tabs.map((t) => {
            const glyph: Record<Tab, string> = {
              automations: "bolt",
              dashboard: "▦",
              requisitions: "▤",
              approvals: "✓",
              "offer-joining": "◷",
              "vendors-spend": "◈",
              schedule: "◷",
              settings: "⚙",
              reports: "⇩",
              "talent-pool": "◎",
              referrals: "↗",
              "support-tickets": "?",
            };
            const openPositionCount = reqs
              .filter((req) => ["Approved", "Position Reopened", "Partially Fulfilled"].includes(req.status))
              .reduce((sum, req) => sum + Math.max(0, req.openings || 0), 0);
            const count = t.id === "approvals"
              ? role === "Recruiter"
                ? offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length
                : role === "HiringManager"
                  ? approvals.filter((requisition) => requisition.status === "PendingApproval").length + offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length
                : approvals.length + offerApprovals.length
              : t.id === "requisitions"
                ? openPositionCount
                : t.id === "schedule"
                  ? ((today?.interviewsToday as unknown[] | undefined) || []).length
                  : 0;
            return (
              <div className="ats-side-group" key={t.id}>
                <button
                  type="button"
                  className={`ats-side-link${tab === t.id ? " is-active" : ""}`}
                  onClick={() => {
                    signalHoneyBadgerMood("smile");
                    if (overlay || candidatePage) closeModal();
                    if (jobDescriptionId && t.id === "requisitions") {
                      router.push("/app/requisitions");
                      return;
                    }
                    setTab(t.id);
                    if (t.id === "referrals") setReferralSection("leaderboard");
                  }}
                  aria-current={tab === t.id ? "page" : undefined}
                  aria-label={t.label}
                  title={t.label}
                >
                  <span className="ats-side-glyph" aria-hidden="true"><WorkspaceIcon name={
                    t.id === "dashboard" ? "home" :
                    t.id === "requisitions" ? "briefcase" :
                    t.id === "schedule" ? "calendar" :
                    t.id === "approvals" ? "shield" :
                    t.id === "offer-joining" ? "fileCheck" :
                    t.id === "talent-pool" || t.id === "referrals" ? "people" :
                    t.id === "automations" ? "bolt" :
                    t.id === "reports" ? "barChart" :
                    t.id === "vendors-spend" ? "document" :
                    t.id === "settings" ? "settings" :
                    t.id === "support-tickets" ? "help" :
                    "document"
                  } size={19} /></span>
                  <span>{t.label}</span>
                  {count > 0 && <b className="ats-nav-count">{count}</b>}
                </button>
                {t.id === "referrals" && role === "Employee" && (
                  <div className="ats-side-subnav" aria-label="Employee referral pages">
                    {([
                      ["leaderboard", "Leaderboard"],
                      ["roles", "Refer a role"],
                      ["referrals", "My referrals"],
                    ] as const).map(([section, label]) => (
                      <button
                        key={section}
                        type="button"
                        className={`ats-side-sublink${referralSection === section ? " is-active" : ""}`}
                        aria-current={tab === "referrals" && referralSection === section ? "page" : undefined}
                        onClick={() => {
                          signalHoneyBadgerMood("smile");
                          setTab("referrals");
                          setReferralSection(section);
                        }}
                      >{label}</button>
                    ))}
                  </div>
                )}
                {t.id === "settings" && role === "Admin" && <div className={`ats-side-subnav ats-settings-subnav${tab === "settings" ? " is-open" : ""}`} aria-label="Settings sections">{([
                  ["company", "Company Profile"], ["teams", "Teams & Access"], ["workflow", "Hiring Workflow"], ["modules", "Modules & Features"], ["integrations", "Integrations"], ["addons", "Referral Program"],
                ] as const).map(([section, label]) => <button key={section} type="button" className={`ats-side-sublink${settingsSection === section ? " is-active" : ""}`} aria-current={tab === "settings" && settingsSection === section ? "page" : undefined} onClick={() => { setTab("settings"); setSettingsSection(section); }}>{label}</button>)}</div>}
              </div>
            );
          })}
        </nav>
        <div className="ats-sidebar-footer">
          <details ref={accountMenuRef} className="ats-account-menu">
            <summary className="ats-profile-avatar" aria-label="Account options" title="Account options">{ini(profile.name)}</summary>
            <div className="ats-account-popover">
              <strong>{profile.name}</strong>
              <small>{profile.email}</small>
              <button type="button" role="menuitem" onClick={() => signOut().then(() => router.push("/login"))}>Sign out</button>
            </div>
          </details>
          <div className="ats-profile-copy">
            <strong title={profile.name}>{profile.name}</strong>
            <small title={`${profile.role} · ${profile.title}`}>{profile.role} · {profile.title}</small>
          </div>
          <button
            type="button"
            className="ats-signout"
            onClick={() => signOut().then(() => router.push("/login"))}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className={`ats-main-column${tab === "settings" && settingsSection === "teams" && role === "Admin" ? " ats-teams-page" : ""}`}>
        <header className={`ats-topbar${tab === "requisitions" ? " ats-topbar-requisitions" : ""}`}>
          <svg className="mist-topbar__waves" viewBox="0 0 860 84" preserveAspectRatio="none" aria-hidden="true">
            <g fill="none" stroke="#3A4046" strokeWidth="1.2" opacity="0.16">
              <path d="M0 62 C 110 18, 220 104, 340 58 S 600 6, 860 50" />
              <path d="M0 72 C 120 32, 240 108, 360 70 S 620 22, 860 64" />
              <path d="M0 52 C 100 8, 210 86, 320 44 S 580 -6, 860 38" />
              <path d="M0 82 C 130 46, 250 112, 380 82 S 640 38, 860 76" />
              <path d="M0 42 C 90 4, 200 70, 300 30 S 560 -14, 860 26" />
            </g>
          </svg>
          <div className="mist-topbar__edge" />

          {orgSettings?.logoUrl ? (
            <div className="mist-brand mist-brand--logo" aria-label="Company logo">
              <Image src={orgSettings.logoUrl} alt={orgSettings.company || "Company logo"} width={220} height={62} unoptimized className="mist-brand__image" />
            </div>
          ) : (
            <div className="mist-brand" aria-label="Vignesh project Z AI ATS brand">
              <span className="mist-brand__name">VIGNESH</span>
              <span className="mist-brand__sub">PROJECT Z - AI ATS</span>
            </div>
          )}

          <div className="mist-section">
            <div className="mist-section__divider" />
            <span className="mist-section__title">Recruitment</span>
          </div>

          {role !== "Employee" && <form className="mist-search" role="search" onSubmit={(event) => { event.preventDefault(); void doSearch(); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3C4044" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search requisitions, candidates, departments."
              aria-label="Search ATS"
            />
          </form>}

          <div className="mist-spacer" />

          {role !== "Employee" && <details ref={notificationsRef} className="mist-notifications" onToggle={(event) => { if (event.currentTarget.open) { void loadApprovals(); void loadNotifications(); } }}>
            <summary aria-label={notificationUnreadCount ? `Notifications, ${notificationUnreadCount} unread` : "Notifications"}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" />
                <path d="M10 21h4" />
              </svg>
              {(notificationUnreadCount > 0 || pendingApprovalCount > 0) && <span className="mist-icon-btn__dot" />}
            </summary>
            <div className="slate-notification-panel">
              <div className="slate-notification-head">
                <div><strong>Notifications</strong><small>{notificationUnreadCount ? `${notificationUnreadCount} unread` : "Recent activity"}</small></div>
                {notificationUnreadCount > 0 && <button className="slate-notification-mark-all" type="button" onClick={() => void markAllNotificationsRead()}>Mark all read</button>}
              </div>
              {pendingApprovalCount > 0 && <button className="slate-notification-action" type="button" onClick={() => { if (notificationsRef.current) notificationsRef.current.open = false; setTab("approvals"); }}>
                <span>{pendingApprovalCount} pending {pendingApprovalCount === 1 ? "approval" : "approvals"}</span><span>Review →</span>
              </button>}
              <div className="slate-notification-feed">
                {notificationItems.map((notification) => <button
                  key={notification.id}
                  className={`slate-notification-item${notification.readAt ? "" : " is-unread"}`}
                  type="button"
                  onClick={() => void openNotification(notification)}
                >
                  <span className="slate-notification-item-title"><strong>{notification.title}</strong>{!notification.readAt && <span aria-label="Unread" />}</span>
                  <span className="slate-notification-item-message">{notification.message}</span>
                  <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                </button>)}
                {!notificationItems.length && <p className="slate-notification-empty">No recent notifications.</p>}
              </div>
            </div>
          </details>}
          <HelpMenu apiFetch={apiFetch} />
        </header>

        {actingAsEmail && (
          <div className="ats-act-as-banner" role="status">
            <span>Acting as {profile.name} ({profile.role}) · Admin session</span>
            <button type="button" onClick={() => stopActingAs().then(() => setTab("dashboard"))}>Exit act as</button>
          </div>
        )}
        {(msg || error) && (
          <div className="ats-message-banner" role="status">
            <span>{msg || error}</span>
            <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss message">×</button>
          </div>
        )}

        <main className={`ats-workspace${tab === "dashboard" ? " ats-overview-workspace" : ""}`}>
        {candidatePage ? panel : showJobDescription && role !== "Employee" && tab === "requisitions" && jobDescriptionId ? (
          <JobDescriptionPage key={jobDescriptionId + profile.email} id={jobDescriptionId} role={profile.role} apiFetch={apiFetch} />
        ) : <>
          {tab !== "requisitions" && tab !== "support-tickets" && !(tab === "dashboard" && role === "Admin") && pageHeading}
        {tab === "support-tickets" && role === "Admin" && <SupportTicketsView apiFetch={apiFetch} />}
        {role === "Employee" && !orgSettings?.employeeReferralsEnabled && (
          <section className="ats-referrals-disabled" role="status">
            <span className="ats-referrals-disabled-mark" aria-hidden="true">HB</span>
            <div><h2>Employee Referrals is unavailable</h2><p>Ask your Admin to enable the Employee Referrals add-on in Settings.</p></div>
          </section>
        )}
        {tab === "referrals" && role === "Employee" && orgSettings?.employeeReferralsEnabled && (
          <EmployeeReferralsView apiFetch={apiFetch} company={orgSettings.company} employeeName={profile.name} employeeEmail={profile.email} section={referralSection} onSectionChange={setReferralSection} />
        )}
        {tab === "dashboard" && role === "Admin" && <RecruitmentHeadOverview data={analytics} today={today} joiners={(offerJoiningData?.upcomingJoiners as Record<string, unknown>[] | undefined) || []} onReq={openPipeline} onCand={openCandidate} onApprovals={() => setTab("approvals")} onJoining={() => setTab("offer-joining")} showJoining={orgSettings?.offerJoiningEnabled === true} />}
        {tab === "dashboard" && role !== "Employee" && role !== "Admin" && (
          <>
            {role === "Recruiter" && <div className="premium-dashboard-brief"><div><span className="premium-eyebrow">YOUR HIRING WORKSPACE</span><p>Start with today’s actions, or ask AI for a brief from your records.</p><button className="premium-secondary" onClick={() => setTab("automations")}>Manage automations <WorkspaceIcon name="arrow" size={16} /></button></div><HiringAssistant apiFetch={apiFetch} mode="brief" embedded onReq={openPipeline} onCand={openCandidate} /></div>}
            {(role === "DepartmentHead" || role === "HiringManager") && <div className="premium-dashboard-brief"><div><span className="premium-eyebrow">YOUR HIRING WORKSPACE</span><p>Get a concise AI brief of the hiring activity and pending actions you can access.</p></div><HiringAssistant key={`${profile.email}-${role}`} apiFetch={apiFetch} mode="brief" embedded onReq={openPipeline} onCand={openCandidate} /></div>}
            {role !== "DepartmentHead" && role !== "HiringManager" && (
              <TodayView
                data={today}
                onReq={openPipeline}
                onCand={openCandidate}
                upcomingJoiners={(offerJoiningData?.upcomingJoiners as Record<string, unknown>[] | undefined) || []}
                onViewAllJoining={() => {
                  signalHoneyBadgerMood("smile");
                  setTab("offer-joining");
                }}
              />
            )}
            <div style={{ marginTop: role === "DepartmentHead" || role === "HiringManager" ? 0 : 28 }}>
              {role === "Recruiter" ? (
                <RecruiterDashboard analytics={analytics} onReq={openPipeline} />
              ) : role === "DepartmentHead" ? (
                <DepartmentHeadDashboard analytics={analytics} onReq={openPipeline} onCand={openCandidate} />
              ) : role === "HiringManager" ? (
                <HiringManagerDashboard analytics={analytics} onReq={openPipeline} />
              ) : (
                <AnalyticsView
                  data={analytics}
                  today={today}
                  onReq={openPipeline}
                  onCand={openCandidate}
                />
              )}
            </div>
          </>
        )}
        {tab === "requisitions" && (
          <ReqBoard
            heading={pageHeading}
            reqs={reqs}
            onOpen={openPipeline}
            role={role!}
            onStatusChange={updateReqStatus}
            onPriorityChange={updateReqPriority}
          />
        )}
        {tab === "automations" && (role === "Admin" || role === "Recruiter") && <AutomationsView key={profile.email} apiFetch={apiFetch} onReq={openPipeline} onCand={openCandidate} />}
        {tab === "approvals" && (
          <ApprovalsView
            list={approvals}
            offerApprovals={offerApprovals}
            apiFetch={apiFetch}
            onOpen={openPipeline}
            onOpenCandidate={openCandidate}
            role={role!}
            onDone={() => {
              loadApprovals();
              loadReqs();
              setMsg("Decision saved.");
            }}
          />
        )}
        {tab === "offer-joining" && (role === "Admin" || role === "Recruiter") && orgSettings?.offerJoiningEnabled && (
          <OfferJoiningView
            rows={(offerJoiningData?.rows as never[] | undefined) || []}
            summary={(offerJoiningData?.summary as { expectedJoiners: number; joiningThisWeek: number; dojRescheduled: number; joinedThisMonth: number; noShows: number } | undefined) || { expectedJoiners: 0, joiningThisWeek: 0, dojRescheduled: 0, joinedThisMonth: 0, noShows: 0 }}
            apiFetch={apiFetch}
            onOpenCandidate={openCandidate}
            onRefresh={() => void loadOfferJoining()}
          />
        )}
        {tab === "vendors-spend" && (role === "Admin" || role === "Recruiter") && orgSettings?.vendorsSpendEnabled && (
          <VendorsSpendView
            data={vendorsSpendData}
            requisitions={reqs}
            role={role}
            apiFetch={apiFetch}
            onOpenCandidate={openCandidate}
            onRefresh={() => void loadVendorsSpend()}
            onMessage={setMsg}
          />
        )}
        {tab === "schedule" && (
          <ScheduleView
            officeLocations={orgSettings?.officeLocations}
            key={
              schedulePrefill
                ? `${schedulePrefill.reqId}-${schedulePrefill.candidateId}-${schedulePrefill.roundIndex}`
                : "schedule"
            }
            reqs={reqs.filter(
              (r) => r.status === "Approved" || r.status === "Position Reopened"
                || r.status === "Partially Fulfilled"
            )}
            apiFetch={apiFetch}
            readOnly={role === "HiringManager"}
            initialReqId={schedulePrefill?.reqId}
            initialCandidateId={schedulePrefill?.candidateId}
            initialRoundIndex={schedulePrefill?.roundIndex}
            onDone={() => {
              setMsg("Interview scheduled.");
              setSchedulePrefill(null);
            }}
          />
        )}
        {tab === "settings" && role === "Admin" && (
          <AdminSettingsView
            section={settingsSection}
            onSectionChange={setSettingsSection}
            org={orgSettings}
            apiFetch={apiFetch}
            onSaved={setOrgSettings}
            requisitions={reqs}
            onRefreshRequisitions={loadReqs}
            teams={(
              <TeamView
                users={team}
                org={orgSettings}
                availableDepartments={teamDepartments}
                departmentDetails={teamDepartmentDetails}
                apiFetch={apiFetch}
                onRefresh={loadTeam}
                currentEmail={profile.email}
                employeeReferralsEnabled={orgSettings?.employeeReferralsEnabled === true}
                onActAs={(user) => {
                  if (!window.confirm(`Act as ${user.name} (${user.role})? Your activity will use this user's permissions.`)) return;
                  startActingAs(user.email)
                    .then(() => setTab(user.role === "Admin" ? "dashboard" : user.role === "DepartmentHead" ? "approvals" : "requisitions"))
                    .catch((cause) => setMsg(cause instanceof Error ? cause.message : "Could not act as this user."));
                }}
              />
            )}
          />
        )}
        {tab === "reports" && role === "Admin" && <><ReportsView data={analytics} /><StatusAuditReport apiFetch={apiFetch} /></>}
        {tab === "talent-pool" && (role === "Admin" || role === "Recruiter") && (
          <TalentPoolView
            requisitions={reqs}
            apiFetch={apiFetch}
            vendorsSpendEnabled={orgSettings?.vendorsSpendEnabled === true}
            onOpenCandidate={openCandidate}
            onDone={(message) => {
              setMsg(message);
              loadReqs();
            }}
          />
        )}
        </>}
      </main>
      </div>

      {tab !== "settings" && (role === "Admin" || role === "Recruiter" || role === "HiringManager" || role === "DepartmentHead") && <HiringAssistant key={`${profile.email}-${role}`} apiFetch={apiFetch} onReq={openPipeline} onCand={openCandidate} />}
      {overlay && pipelinePanel && (
        <div className="ats-overlay" onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}>
          <div className="ats-dialog">
            {pipelinePanel}
          </div>
        </div>
      )}
      {overlay && panel && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) dismissModal();
          }}
          className="ats-overlay"
        >
          <div
            className="ats-dialog"
          >
            <button
              type="button"
              className="ats-dialog-close"
              onClick={dismissModal}
              aria-label="Close panel"
            >
              ✕
            </button>
            {panel}
          </div>
        </div>
      )}
    </div>
  );
}
