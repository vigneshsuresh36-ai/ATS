import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const projectId = createHash("sha256")
  .update(projectRoot)
  .digest("hex")
  .slice(0, 12);
const distDir = path.join(os.tmpdir(), "letstransport-ats-next", projectId);
const lockPath = path.join(os.tmpdir(), `letstransport-ats-next-${projectId}.lock`);
const linkedNodeModules = path.join(distDir, "node_modules");

function acquireDevLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existingPid = Number(fs.readFileSync(lockPath, "utf8"));
      try {
        process.kill(existingPid, 0);
        console.error("Another ATS dev server is already running. Stop it before starting another one.");
        process.exit(1);
      } catch (processError) {
        if (processError.code !== "ESRCH") throw processError;
        fs.rmSync(lockPath, { force: true });
      }
    }
  }
  throw new Error("Could not acquire the ATS dev-server lock.");
}

function releaseDevLock() {
  try {
    if (Number(fs.readFileSync(lockPath, "utf8")) === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch {}
}

acquireDevLock();
process.on("exit", releaseDevLock);

function ensureNodeModulesJunction() {
  fs.mkdirSync(distDir, { recursive: true });
  if (!fs.existsSync(linkedNodeModules)) {
    fs.symlinkSync(path.join(projectRoot, "node_modules"), linkedNodeModules, "junction");
  }
}

ensureNodeModulesJunction();
const nodePath = [
  path.join(projectRoot, "node_modules"),
  process.env.NODE_PATH,
]
  .filter(Boolean)
  .join(path.delimiter);

const next = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)],
  {
    env: { ...process.env, NODE_PATH: nodePath },
    stdio: ["inherit", "pipe", "inherit"],
  }
);

let startupOutput = "";
next.stdout.on("data", (chunk) => {
  const output = chunk.toString();
  process.stdout.write(output);
  startupOutput = (startupOutput + output).slice(-512);
  if (startupOutput.includes("Ready in")) ensureNodeModulesJunction();
});

next.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

next.on("exit", (code) => {
  process.exitCode = code ?? 1;
});