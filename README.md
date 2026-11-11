# Pathtoon — stories you steer

A mobile-first website (installable PWA) for vertical-scroll comics. Readers sign in,
read the current free story, and (from Stage 2) comment on what should happen next.
The top-voted comment decides the next episode's action. Socials only carry teasers;
the comics live here.

**Stage 1 (this build):** project setup, sign-in (Google + email link), database,
Morning Brew episode 1 with 12 placeholder panels, the vertical reader, share links,
social preview images, and PWA basics.
**Stage 3 (admin):** see section 6 below.
**Not built yet:** comments and voting (Stage 2), story builder (Stage 4).
**Never in v1:** payments. A `SUBSCRIPTIONS_ENABLED` flag and `role`/`plan` columns are ready for later.

> **It works before you set anything up.** With no keys it runs in *demo mode* using
> built-in sample data, so you can see the reader straight away.

---

## 1. Run it on your computer (about 5 minutes)

You need Node.js 20 or newer (check with `node -v`). Open **PowerShell** in this folder:

```powershell
cd C:\Users\tcmac\OneDrive\Documents\webzthing
npm install
npm run dev
```

Open <http://localhost:3000>. You should see "Comics you steer", the Morning Brew card,
and a pale "Demo mode" banner. Tap **Start reading** and scroll through 12 grey panels.
Press `Ctrl+C` in PowerShell to stop it.

Visit <http://localhost:3000/setup> any time. It shows a tick or cross for each setting
(it never shows the values).

### Secrets file

Copy the template and fill it in as you go:

```powershell
copy .env.example .env.local
```

`.env.local` is for your real keys. It is **never committed** (see `.gitignore`).
Restart `npm run dev` after changing it.

| Name | Needed from | Where to get it | Safe in browser? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Stage 1 | Supabase > Project Settings > API > Project URL. Just `https://xxxxxxxx.supabase.co` — nothing after `.co` (no `/rest/v1/`) | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Stage 1 | Same page > `anon` `public` key | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Stage 3 | Same page > `service_role` key | **NO — server only** |
| `NEXT_PUBLIC_SITE_URL` | Stage 1 | `http://localhost:3000` locally, your Vercel address when live | yes |
| `ADMIN_EMAIL` | Stage 3 | The email you sign in with | server |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Stage 2 | Cloudflare Turnstile (free) | site key yes, secret **NO** |
| `LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY` | Stage 4 | console.anthropic.com (pay-as-you-go) | **NO — server only** |
| `SUBSCRIPTIONS_ENABLED` | later | leave `false` | server |

Only names starting `NEXT_PUBLIC_` ever reach the browser. Never put a secret behind
that prefix, and never paste keys into chat, email or a commit.

---

## 2. Accounts for Stage 1

1. **GitHub** (free): to hold the code.
2. **Supabase** (free tier): database, sign-in, image storage.
3. **Google Cloud** (free): for "Continue with Google".
4. **Vercel** (free Hobby tier while testing): hosts the site.

### 2a. Supabase

1. Create a project at <https://supabase.com> (pick a region near the UK, e.g. London).
2. **SQL Editor > New query:** paste all of `supabase/migrations/0001_init.sql`, press **Run**.
3. **SQL Editor > New query:** paste all of `supabase/seed.sql`, press **Run**. This adds
   Morning Brew, episode 1, and 12 placeholder panels. (To regenerate it after editing
   `data/morning-brew.json`, run `npm run seed:sql`.)
4. **Project Settings > API:** copy the Project URL and the `anon` key into `.env.local`.
5. **Authentication > URL Configuration:** set **Site URL** to `http://localhost:3000` and
   add `http://localhost:3000/**` under **Redirect URLs**. (Add your Vercel address later.)
6. Restart `npm run dev` and open `/setup`. You want ticks down to "Morning Brew is seeded".

### 2b. Make yourself admin (needed from Stage 3)

Sign in once on the site, then in Supabase **SQL Editor** run (with your email):

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Roles can only be changed here in the dashboard, never from the website.

### 2c. Sign in with Google

1. <https://console.cloud.google.com> > create a project.
2. **APIs & Services > OAuth consent screen:** choose **External**, add an app name and your email, save.
3. **Credentials > Create credentials > OAuth client ID > Web application.**
   Under **Authorised redirect URIs** add
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
   (Supabase shows the exact address under **Authentication > Providers > Google**).
4. Copy the **Client ID** and **Client secret** into **Supabase > Authentication >
   Providers > Google**, switch it on, save. *These two never go in `.env.local` or the code.*

While Google's consent screen is in "Testing", only email addresses you add as test users can
sign in. Publish the app when you're ready for everyone.

### 2d. Email sign-in link

Works out of the box. Supabase's built-in email sender is limited to a few emails an
hour, which is fine for testing; add your own email service (SMTP) before launch.
Open the link in **the same browser** you asked for it from (a safety feature).

---

## 3. Put it online with Vercel

1. Put the code on GitHub (**GitHub Desktop** is the easiest way: *File > Add local
   repository*, then *Publish repository*; keep it private if you like).
2. <https://vercel.com> > **Add New > Project** > pick the repo. Framework is detected as Next.js.
3. Before deploying, open **Environment Variables** and add the same names and values as
   your `.env.local` (set `NEXT_PUBLIC_SITE_URL` to your Vercel address once you know it).
   `.env.local` does **not** upload itself — this step is separate.
4. Deploy. Then add the Vercel address under **Supabase > Authentication > URL
   Configuration > Redirect URLs** (e.g. `https://your-app.vercel.app/**`) and set
   `NEXT_PUBLIC_SITE_URL` to it (then redeploy).
5. Your own domain (Namecheap) can wait: in Vercel > Domains you add it and Vercel tells you
   the DNS records to enter at Namecheap.

> **Heads-up on paid plans.** Vercel's Hobby tier is for personal, non-commercial use, so you
> will need a paid plan once you start charging £2.99/month. Supabase's free tier pauses a
> project after a week of no activity (one click to resume) and has no automatic backups.

---

## 4. Testing on your phone ("working" looks like this)

Easiest: test the **Vercel address** on your phone (Google sign-in needs a real web address).
Check:

- [ ] The home page loads quickly and the **Morning Brew** card has a big **Start reading** button.
- [ ] Episode 1 scrolls smoothly, panels fill the screen width, **no sideways scrolling**.
- [ ] Gaps between panels shrink with the screen but keep their rhythm; the **last gap is the longest** (the payoff pause).
- [ ] Panels below the first load as you scroll (not all at once).
- [ ] The end card says **"What happens next? Comment and vote."**
- [ ] **Share this episode** opens your phone's share sheet.
- [ ] **Sign in** works with Google and with the email link, and the button then says **Sign out**.
- [ ] Light/dark switch works (button in the header: Auto / Light / Dark).
- [ ] **Install:** Chrome menu > *Add to Home screen* (Android) or Share > *Add to Home Screen* (iPhone). It opens full-screen with the Pathtoon icon.
- [ ] Pasting an episode link into WhatsApp or Messages shows a preview card with the title.

On your own Wi-Fi you can also run `npm run dev:phone` and open `http://YOUR-PC-IP:3000`
on the phone (Windows may ask to allow Node through the firewall). Sign-in won't work there.

---

## 5. Uploading panels by hand (older method)

The admin area (section 6) does this for you. If you ever need to do it manually:

1. Export each panel as an image **800px wide** (draw at 1600px and halve it) — JPG or WebP
   keeps it fast. Name them `ep1-01.jpg`, `ep1-02.jpg`, and so on.
2. Supabase > **Storage > panels** (created by the SQL) > upload the files.
   Click each one > **Copy URL**.
3. Supabase > **Table Editor > panels**: for each panel row, paste the URL into `image_url`
   and set `height` to the image's height in pixels (at 800px wide). Add a short description
   in `alt` for screen readers.
4. Set `gap_after` (empty scroll after the panel, in 800px-wide pixels):
   same scene **150–300** · scene jump **500–800** · before the payoff **1000+**.

Refresh the episode page: the placeholders are replaced and the gaps follow your numbers.

---

## How the code is laid out

```
src/app/                  pages: home, series, episode reader, login, setup check
src/components/           Reader (panels + gaps), EndCard, Header, ThemeToggle, LoginForm …
src/lib/data.ts           all database reads (falls back to demo data without keys)
src/lib/supabase/         browser + server Supabase clients (anon key + RLS only)
supabase/migrations/      the database: tables, security rules (RLS), storage bucket
supabase/seed.sql         Morning Brew episode 1 (generated from data/morning-brew.json)
data/morning-brew.json    the starter content: edit, then `npm run seed:sql`
public/sw.js, icons/      installable-app basics
```

Security in one paragraph: the browser only ever holds the public anon key. What each person
may read or change is decided by **Row Level Security** inside the database (drafts are
hidden from readers; only admins can write). The service-role key, which bypasses those rules,
is only for server code from Stage 3 and must never be exposed.

Hooks left for later: `episodes.vote_closes_at` and `hide_vote_counts` (voting, Stage 2),
`profiles.plan` and `subscriptionsEnabled()` in `src/lib/env.ts` (paid plan), and a clean
spot for image generation in the Stage 4 story builder (out of scope for v1).

---

## 6. The admin area (Stage 3)

1. Run `supabase/migrations/0002_admin_access.sql` once in the Supabase SQL Editor
   (adds free / paid-early episodes and the panel re-order function).
   Then run `supabase/migrations/0003_admin_storage_read.sql` (lets admins delete
   uploaded images, so removed panels don't leave files behind).
   Then run `supabase/migrations/0004_comments.sql` (comments on every episode).
2. Sign in as the admin account (see 2b). An **Admin** button appears in the header.
3. **Admin > New series**, then **New episode**. Episodes start as drafts.
4. On the episode page: **Add panel images** (pick them all at once; they are shrunk and
   uploaded from your phone), re-order with the arrows, set the gap after each panel,
   choose **Free** or **Paid early** (+ the date it becomes free), then **Publish now**.

Paid-early episodes: admins and anyone whose `profiles.plan` is `supporter` can read them
straight away; everyone else sees a lock card until the "free from" date. There are no
payments yet, so set a supporter by hand:
`update public.profiles set plan = 'supporter' where email = '...';`
