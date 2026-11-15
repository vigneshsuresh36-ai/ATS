import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ReqBoard } from "../src/components/ats/ReqBoard";
import { hidePriorityForRole } from "../src/lib/requisitionPriorityAccess";
import type { Requisition } from "../src/lib/types";

const base = { id: "R1", title: "Role one", department: "Technology", location: "Bengaluru", raisedByName: "Manager", openings: 1, status: "Position Reopened", priorityLevel: "P2", previousPriorityLevel: "P1", candidateCount: 0 } as Requisition & { candidateCount: number };

for (const role of ["DepartmentHead", "HiringManager"] as const) {
  test(`${role} cannot see priority in the board or requisition data`, () => {
    const html = renderToStaticMarkup(<ReqBoard reqs={[base]} role={role} onOpen={() => {}} />);
    assert.doesNotMatch(html, /Priority|P2|P1 \(previous\)/);
    const visible = hidePriorityForRole(base, role);
    assert.equal(visible.priorityLevel, undefined);
    assert.equal(visible.previousPriorityLevel, undefined);
    assert.equal(visible.title, base.title);
  });
}
test("admin retains priority visibility and editing", () => {
  const html = renderToStaticMarkup(<ReqBoard reqs={[base]} role="Admin" onOpen={() => {}} onPriorityChange={async () => base} />);
  assert.match(html, /Priority for Role one/);
  assert.equal(hidePriorityForRole(base, "Admin").priorityLevel, "P2");
});
