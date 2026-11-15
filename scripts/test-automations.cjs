/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS bootstrap installs the TypeScript require hook. */
// Use the installed TypeScript compiler directly; avoids tsx's Windows userInfo dependency.
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
require.extensions[".ts"] = require.extensions[".tsx"] = function compile(module, file) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const output = result.outputText.replace(/require\("@\/([^"\n]+)"\)/g, (_, relative) => `require(${JSON.stringify(path.join(__dirname, "..", "src", relative))})`);
  module._compile(output, file);
};
if (require.main === module) {
  require('../tests/recruitmentDrive.test.ts');
  require("../tests/automationPlanner.test.ts");
  require("../tests/automationUI.test.tsx");
  require("../tests/careersVisibility.test.ts");
  require("../tests/initialAdministrator.test.ts");
  require("../tests/integrationRequests.test.ts");
  require("../tests/applicationSource.test.ts");
  require("../tests/calendarAvailability.test.ts");
  require("../tests/selfScheduling.test.ts");
  require("../tests/authenticatedFetch.test.ts");
  require("../tests/requisitionPriority.test.tsx");
  require("../tests/assistantAccess.test.ts");
  require("../tests/statusAudit.test.ts");
  require("../tests/vendorFeeLiability.test.ts");
  require("../tests/interviewPlan.test.ts");
  require("../tests/candidateReopening.test.ts");
  require("../tests/joiningTimeline.test.ts");
}


