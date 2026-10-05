"use client";

import { useState, type CSSProperties } from "react";
import { DEPARTMENTS } from "@/lib/roles";
import { Chip, inp, lab, saveBtn } from "./ui";
import type { AppUser, Role } from "@/lib/types";

function roleLabel(role: Role) {
  if (role === "HiringManager") return "Hiring Manager";
  if (role === "DepartmentHead") return "Department Head";
  if (role === "Recruiter") return "Recruiter";
  return role;
}

export function TeamView({
  users,
  apiFetch,
  onRefresh,
  onActAs,
  currentEmail,
}: {
  users: AppUser[];
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
  onActAs?: (user: AppUser) => void;
  currentEmail: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("DepartmentHead");
  const [departments, setDepartments] = useState<string[]>([]);
  const [roleEdits, setRoleEdits] = useState<Record<string, Role>>({});
  const [departmentEdits, setDepartmentEdits] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  function toggleDept(d: string) {
    setDepartments((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  function toggleUserDepartment(user: AppUser, department: string) {
    setDepartmentEdits((current) => {
      const assigned = current[user.email] || user.departments || [];
      return {
        ...current,
        [user.email]: assigned.includes(department)
          ? assigned.filter((item) => item !== department)
          : [...assigned, department],
      };
    });
  }

  async function addMember() {
    setBusy(true);
    try {
      const r = await apiFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, departments }),
      });
      const d = await r.json();
      if (!r.ok) alert(d.error);
      else {
        setName("");
        setEmail("");
        setDepartments([]);
        onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveUserAccess(user: AppUser) {
    const nextRole = roleEdits[user.email] || user.role;
    const nextDepartments = departmentEdits[user.email] || user.departments || [];
    const needsManagerAssignment = nextRole === "Recruiter" && user.managerEmail !== currentEmail.toLowerCase();
    if (nextRole === user.role && sameDepartments(nextDepartments, user.departments || []) && !needsManagerAssignment) return;
    const response = await apiFetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        role: nextRole,
        departments: nextDepartments,
      }),
    });
    const result = await response.json();
    if (!response.ok) alert(result.error || "Could not update role.");
    else {
      setRoleEdits((current) => ({ ...current, [user.email]: nextRole }));
      onRefresh();
    }
  }

  return (
    <div style={{ width: "100%" }}>
      <div style={{ marginBottom: 18 }}>
        <h2 className="ats-heading-section">
          Team & access
        </h2>
        <p className="ats-heading-subtitle">
          Add recruiters to your team, assign them to approved requisitions, and manage business-role access.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
        className="ats-team-grid"
      >
        {users.map((u) => {
          const editedRole = roleEdits[u.email] || u.role;
          const editedDepartments = departmentEdits[u.email] || u.departments || [];
          const canEditDepartments = editedRole === "HiringManager" || editedRole === "DepartmentHead";
          const roleChanged = editedRole !== u.role;
          const departmentsChanged = !sameDepartments(editedDepartments, u.departments || []);
          const needsManagerAssignment = editedRole === "Recruiter" && u.managerEmail !== currentEmail.toLowerCase();
          const needsSave = roleChanged || departmentsChanged || needsManagerAssignment;
          const isSelf = u.email.toLowerCase() === currentEmail.toLowerCase();
          return (
          <div key={u.email} style={memberCard}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{u.name}</span>
                  <Chip>{roleLabel(u.role)}</Chip>
                </div>
                <div style={{ fontSize: 13, color: "#666", wordBreak: "break-all" }}>
                  {u.email}
                </div>
                {u.managerEmail && <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>Managed by {u.managerEmail}</div>}
                {canEditDepartments && (
                  <DepartmentPicker
                    selected={editedDepartments}
                    onToggle={(department) => toggleUserDepartment(u, department)}
                    disabled={isSelf}
                    label={`Departments for ${u.name}`}
                  />
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <select
                  aria-label={`Role for ${u.name}`}
                  style={{ ...inp, width: 150, margin: 0, fontSize: 12 }}
                  disabled={isSelf}
                  value={editedRole}
                  onChange={(event) => setRoleEdits((current) => ({ ...current, [u.email]: event.target.value as Role }))}
                >
                  <option value="Admin">Admin</option>
                  <option value="Recruiter">Recruiter</option>
                  <option value="HiringManager">Hiring Manager</option>
                  <option value="DepartmentHead">Department Head</option>
                </select>
                {!isSelf && needsSave && <button type="button" style={{ ...saveBtn, opacity: canEditDepartments && editedDepartments.length === 0 ? 0.55 : 1 }} disabled={canEditDepartments && editedDepartments.length === 0} onClick={() => saveUserAccess(u)}>{editedRole === u.role && needsManagerAssignment ? "Add to my team" : "Save access"}</button>}
                {onActAs && u.active && <button type="button" style={actAsBtn} onClick={() => onActAs(u)}>Act as</button>}
                {u.email.toLowerCase() !== currentEmail.toLowerCase() && <button
                  type="button"
                  style={removeBtn}
                  onClick={async () => {
                    await apiFetch(
                      `/api/team?email=${encodeURIComponent(u.email)}`,
                      { method: "DELETE" }
                    );
                    onRefresh();
                  }}
                >
                  Remove
                </button>}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <section style={panel}>
        <h3 className="ats-heading-panel" style={{ marginBottom: 14 }}>Add member</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 14,
          }}
          className="ats-team-form"
        >
          <div>
            <label style={{ ...lab, marginTop: 0 }}>Name</label>
            <input
              style={inp}
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ ...lab, marginTop: 0 }}>Email</label>
            <input
              style={inp}
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label style={{ ...lab, marginTop: 0 }}>Role</label>
            <select
              style={inp}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="Admin">Admin</option>
              <option value="Recruiter">Recruiter</option>
              <option value="HiringManager">Hiring Manager</option>
              <option value="DepartmentHead">Department Head</option>
            </select>
          </div>
        </div>

        {(role === "HiringManager" || role === "DepartmentHead") && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              Departments *
            </div>
            <DepartmentPicker selected={departments} onToggle={toggleDept} label="Select departments" />
          </div>
        )}

        <div
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTop: "1px solid #f0ece3",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            style={{ ...saveBtn, minWidth: 120 }}
            disabled={busy}
            onClick={addMember}
          >
            {busy ? "Adding…" : "Add member"}
          </button>
        </div>
      </section>

      <style>{`
        @media (max-width: 900px) {
          .ats-team-grid, .ats-team-form {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function DepartmentPicker({
  selected,
  onToggle,
  disabled = false,
  label,
}: {
  selected: string[];
  onToggle: (department: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <details style={departmentDropdown}>
      <summary
        aria-label={label}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        style={{ ...departmentSummary, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.7 : 1 }}
      >
        <span style={departmentSummaryText}>
          {selected.length === 0
            ? "Select departments"
            : selected.length === 1
              ? selected[0]
              : `${selected[0]} +${selected.length - 1} more`}
        </span>
        <span aria-hidden="true" style={departmentChevron}>⌄</span>
      </summary>
      <div style={departmentMenu}>
        {DEPARTMENTS.map((department) => (
          <label key={department} style={departmentOption}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(department)}
              onChange={() => onToggle(department)}
            />
            {department}
          </label>
        ))}
      </div>
    </details>
  );
}

function sameDepartments(left: string[], right: string[]) {
  return left.length === right.length && left.every((department) => right.includes(department));
}

const panel: CSSProperties = {
  background: "#fff",
  border: "1px solid #ebe6da",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 0 rgba(40,35,20,.03)",
};

const memberCard: CSSProperties = {
  ...panel,
  padding: 16,
  minHeight: 112,
};

const departmentDropdown: CSSProperties = { position: "relative", width: "100%", marginTop: 8 };
const departmentSummary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 38, padding: "8px 10px", border: "1px solid #d8dce1", borderRadius: 7, background: "#fff", color: "#39414a", fontSize: 12, fontWeight: 600, listStyle: "none" };
const departmentSummaryText: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const departmentChevron: CSSProperties = { flexShrink: 0, color: "#69737e", fontSize: 14 };
const departmentMenu: CSSProperties = { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 3, maxHeight: 220, overflowY: "auto", padding: 7, border: "1px solid #d8dce1", borderRadius: 7, background: "#fff", boxShadow: "0 8px 18px rgba(25, 32, 40, .14)" };
const departmentOption: CSSProperties = { display: "flex", alignItems: "center", gap: 6, minWidth: 0, padding: "7px 5px", borderRadius: 5, color: "#39414a", fontSize: 11, cursor: "pointer" };

const removeBtn: CSSProperties = {
  background: "#faf5f5",
  color: "#9a3b3b",
  border: "1px solid #ecd5d5",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1.2,
  alignSelf: "center",
  flexShrink: 0,
};

const actAsBtn: CSSProperties = {
  background: "#eef3f8",
  color: "#315f8d",
  border: "1px solid #d6e2ee",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1.2,
};
