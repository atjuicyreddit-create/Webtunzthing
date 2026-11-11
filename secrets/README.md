# secrets/

**Real keys live here only. Never commit, screenshot or paste them into chat.**

- `secrets/.env.local` holds the real keys. You create it yourself by copying `.env.example`
  and filling in the values. Git ignores it, and a commit check blocks anything that looks
  like a key.
- `secrets/.env.example` lists every variable, empty, with a note on what it's for.
- The live site doesn't use this folder: the same values go into Vercel
  (Project > Settings > Environment Variables). See the README, "Pathtoon Studio".

If a key ever leaks, rotate it straight away (README, "If a key leaks").
