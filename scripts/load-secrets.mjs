// Loads secrets/.env.local into process.env when the app starts (server side only).
// Next.js reads only .env files in the project root, so next.config.mjs calls this.
// Values already set (Vercel env vars, or an old root .env.local) always win.
// Never logs values.
import fs from "node:fs";
import path from "node:path";

export function loadSecrets(root = process.cwd()) {
  const file = path.join(root, "secrets", ".env.local");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0; // no file: fine on Vercel and before Tom creates it
  }
  let loaded = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // strip an inline comment after whitespace:  KEY=value   # note
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      if (value !== "") {
        process.env[key] = value;
        loaded++;
      }
    }
  }
  return loaded;
}
