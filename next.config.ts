import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const projectId = createHash("sha256")
  .update(process.cwd())
  .digest("hex")
  .slice(0, 12);
const localDevDistDir = path.relative(
  process.cwd(),
  path.join(os.tmpdir(), "letstransport-ats-next", projectId)
);

export default function nextConfig(phase: string): NextConfig {
  return {
    distDir:
      phase === PHASE_DEVELOPMENT_SERVER ? localDevDistDir : ".next",
    serverExternalPackages: [
      "firebase-admin",
      "googleapis",
      "googleapis-common",
      "google-auth-library",
      "jose",
      "jwks-rsa",
      "pdf-parse",
      "mammoth",
    ],
  };
}
