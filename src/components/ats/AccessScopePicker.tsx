"use client";

import { useState } from "react";
import { departmentOptions, parseAccessScopes } from "@/lib/requisitionScope";
import type { OrgSettings, RequisitionAccessScope } from "@/lib/types";

const scopeLabel = ({ businessUnit, department, subDepartment }: RequisitionAccessScope) =>
  [businessUnit, department, subDepartment || "All sub-departments"].join(" / ");

export function AccessScopePicker({ org, value, onChange, disabled = false }: {
  org: OrgSettings;
  value: RequisitionAccessScope[];
  onChange: (scopes: RequisitionAccessScope[]) => void;
  disabled?: boolean;
}) {
  const [unit, setUnit] = useState("");
  const [department, setDepartment] = useState("");
  const [subDepartment, setSubDepartment] = useState("");
  const availableDepartments = unit ? departmentOptions(org, unit) : [];
  const teams = (org.subDepartments ?? []).filter((item) => item.department === department);

  return (
    <details className="ats-team-access-scope">
      <summary>{value.length ? value.length + (value.length === 1 ? " access scope" : " access scopes") : "Assign access scope"}</summary>
      <ul>
        {value.map((scope) => <li key={scopeLabel(scope)}>
          <span>{scopeLabel(scope)}</span>
          {!disabled && <button type="button" aria-label={"Remove " + scopeLabel(scope)} onClick={() => onChange(value.filter((entry) => entry !== scope))}>Remove</button>}
        </li>)}
      </ul>
      {!disabled && <div className="ats-team-access-scope-fields">
        <select aria-label="Business unit for access" value={unit} onChange={(event) => { setUnit(event.target.value); setDepartment(""); setSubDepartment(""); }}>
          <option value="">Business unit</option>
          {(org.businessUnits ?? []).map((name) => <option key={name}>{name}</option>)}
        </select>
        <select aria-label="Department for access" value={department} disabled={!unit} onChange={(event) => { setDepartment(event.target.value); setSubDepartment(""); }}>
          <option value="">Department</option>
          {availableDepartments.map((name) => <option key={name}>{name}</option>)}
        </select>
        <select aria-label="Sub-department for access" value={subDepartment} disabled={!department || !teams.length} onChange={(event) => setSubDepartment(event.target.value)}>
          <option value="">All sub-departments</option>
          {teams.map(({ name }) => <option key={name}>{name}</option>)}
        </select>
        <button type="button" className="ats-team-save" disabled={!unit || !department} onClick={() => {
          const scopes = parseAccessScopes([...value, { businessUnit: unit, department, subDepartment }], org);
          if (scopes) onChange(scopes);
        }}>Add scope</button>
      </div>}
    </details>
  );
}
