import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const required = [
  ".next/BUILD_ID",
  "prisma/migrations/20261007010000_security_mfa_and_rate_limits/migration.sql",
  "deployment/nginx/security-http.conf.example",
  "deployment/nginx/security-proxy-headers.conf",
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) throw new Error(`Missing candidate input: ${path}`);
}

const emailService = readFileSync(resolve(root, "src/lib/email/service.ts"), "utf8");
const nginxConfig = readFileSync(resolve(root, "deployment/nginx/security-http.conf.example"), "utf8");
if (!emailService.includes("/reset-password#token=") || emailService.includes("/reset-password?token=")) throw new Error("Reset token transport is not fragment-only.");
if (nginxConfig.includes("$request_uri") || nginxConfig.includes("$http_referer")) throw new Error("Nginx candidate can log a sensitive URL value.");

console.log("SECURITY_CANDIDATE_SMOKE_OK");
