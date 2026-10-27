import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Scan only candidate additions. Never open an environment file or credential store.
const baseline = "15915ddb4fc9453b671ba7772a2924acbfa91503";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const added = git("diff", "--no-ext-diff", "--unified=0", baseline).split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).map(line => line.slice(1));
const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
for (const file of untracked) {
  assert.ok(!/^\.env(?!\.example$)/.test(file), "Environment file unexpectedly included");
  added.push(...readFileSync(file, "utf8").split("\n"));
}
const failures = [];
for (let i = 0; i < added.length; i++) {
  const line = added[i];
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) failures.push("PRIVATE_KEY");
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsk_live_[A-Za-z0-9]{20,}/.test(line)) failures.push("PROVIDER_CREDENTIAL");
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(line)) failures.push("JWT_LITERAL");
  for (const match of line.matchAll(/postgres(?:ql)?:\/\/[^\s"'`]+/g)) {
    // Test-only URLs must stay on loopback; template interpolation uses a verified disposable binding.
    if (!/@(?:127\.0\.0\.1|localhost)(?::|\/)/.test(match[0])) failures.push("NONLOCAL_DATABASE_URL");
  }
  const assignment = line.match(/^\s*(?:WELLHUB_API_TOKEN|WELLHUB_WEBHOOK_SECRET|MP_ACCESS_TOKEN|DATABASE_URL)\s*=\s*(.+)$/);
  if (assignment && !/^(?:["']?["']?|<[^>]+>|\$\{[^}]+\})\s*$/.test(assignment[1])) failures.push("NONEMPTY_ENV_ASSIGNMENT");
}
assert.equal(failures.length, 0, `Candidate secret scan failed: ${[...new Set(failures)].join(", ")}`);
console.log(JSON.stringify({ ok: true, scan: "candidate-added-content credential-pattern scan", linesScanned: added.length, environmentFilesLoaded: false, findings: 0 }, null, 2));
