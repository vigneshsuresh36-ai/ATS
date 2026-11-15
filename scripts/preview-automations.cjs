/* eslint-disable @typescript-eslint/no-require-imports -- Uses the shared CommonJS TypeScript bootstrap. */
// Static preview of the real component; never connects to Firebase, AI, or email.
require("./test-automations.cjs");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AutomationsView } = require("../src/components/ats/AutomationsView.tsx");
const { defaultAutomationSettings } = require("../src/lib/automationTypes.ts");
const settings = defaultAutomationSettings();
for (const workflow of Object.values(settings)) workflow.enabled = true;
const stamp = "2026-10-28T06:00:00Z";
const common = { ownerEmail: "sample@example.com", reqId: "REQ-SAMPLE", sourceVersion: stamp, recipients: ["sample@example.com"], subject: "Application update", body: "Sample message for review.", createdAt: stamp, updatedAt: stamp };
const tasks = [
  { ...common, id: "preview-1", workflow: "updates", title: "Candidate stage update", detail: "Arjun Mehta · Interview", status: "pending" },
  { ...common, id: "preview-2", workflow: "briefs", title: "AI interview brief", detail: "Sneha Rao · Product Designer", body: "Sample brief", status: "pending" },
  { ...common, id: "preview-3", workflow: "feedback", title: "Feedback reminder", detail: "Daniel Kim · Technical round", status: "failed", error: "No interviewer email is available." },
  { ...common, id: "preview-4", workflow: "approvals", title: "Hiring request awaiting approval", detail: "Senior Backend Engineer", status: "sent" },
];
const content = renderToStaticMarkup(React.createElement(AutomationsView, { apiFetch: async () => { throw new Error("Static preview only"); }, onReq: () => {}, onCand: () => {}, initialData: { settings, tasks, integrations: { ai: false, email: false, scheduler: false } } }));
const css = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8").replace('@import "tailwindcss";', "") + fs.readFileSync(path.join(__dirname, "../src/app/premium.css"), "utf8");
const nav = ["Today", "Hiring Requests", "Interviews", "Approvals", "Offers & Joining", "Talent Pool", "Automations", "Reports", "Settings"].map((name) => `<div class="ats-side-group"><button class="ats-side-link${name === "Automations" ? " is-active" : ""}"><span>${name}</span></button></div>`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>STARSHIP · Implementation preview</title><style>${css}</style></head><body><div class="ats-app-shell premium-workspace"><aside class="ats-sidebar"><div class="ats-brand" style="font-size:22px;letter-spacing:2px;color:white">STARSHIP</div><nav class="ats-side-nav">${nav}</nav><div class="ats-sidebar-footer"><div class="ats-profile-avatar">PS</div><div class="ats-profile-copy"><strong>Priya Sharma</strong><small>Sample recruiter</small></div></div></aside><div class="ats-main-column"><header class="ats-topbar"><span class="premium-muted">Workspace / Automations</span><span style="margin-left:auto;font-size:11px;color:#777">STATIC PREVIEW · SAMPLE DATA · CONTROLS INACTIVE</span></header><main class="ats-workspace">${content}</main></div></div></body></html>`;
const destination = path.join(__dirname, "../output/designs/starship-implementation-preview.html");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, html);
console.log(destination);
