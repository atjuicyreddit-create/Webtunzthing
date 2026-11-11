#!/usr/bin/env node
// Pre-commit check: blocks a commit if any added line looks like a real key.
// Runs from .githooks/pre-commit. It never prints the matched text, only where it is.
import { execFileSync } from "node:child_process";

const PATTERNS = [
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "OpenAI-style key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "Supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: "JWT (e.g. Supabase anon/service key)", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/ },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "Key-like value assigned to a *_KEY / *_SECRET / *_TOKEN variable",
    re: /\b[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*["']?[A-Za-z0-9_\-./+]{24,}/,
  },
];

// Files that may legitimately contain these shapes (none today). Keep this list short.
const ALLOW_FILES = new Set(["scripts/check-secrets.mjs"]);

function staged() {
  return execFileSync("git", ["diff", "--cached", "--no-color", "-U0", "--diff-filter=ACMR"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const problems = [];
let file = null;
let line = 0;
for (const raw of staged().split("\n")) {
  if (raw.startsWith("+++ ")) {
    file = raw.slice(4).replace(/^b\//, "");
    continue;
  }
  const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
  if (hunk) {
    line = Number(hunk[1]);
    continue;
  }
  if (!file || ALLOW_FILES.has(file)) continue;
  if (raw.startsWith("+") && !raw.startsWith("+++")) {
    const text = raw.slice(1);
    for (const p of PATTERNS) {
      if (p.re.test(text)) problems.push(`${file}:${line}  looks like: ${p.name}`);
    }
    line++;
  }
}

if (problems.length) {
  console.error("\n✋ Commit blocked: something in this commit looks like a secret key.\n");
  for (const p of problems) console.error("   " + p);
  console.error(
    "\nReal keys belong in secrets/.env.local (git-ignored), never in committed files." +
      "\nRemove the value and commit again. If it was a real key, rotate it (README: 'If a key leaks').\n",
  );
  process.exit(1);
}
