# Auth email templates

Supabase stores these in the dashboard, not in the repo — the files here are the source of
truth to paste from, review in a diff, and rebuild from if the project is ever recreated.

Paste into **Authentication → Emails** on project `pkytnujhwjxudtrudihu` (DCU Timetables):

| File | Dashboard template | Subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | `Confirm your DCU email` |
| `reset-password.html` | Reset password | `Set a new password for DCU Timetable` |

`/auth/v1/resend` reuses **Confirm signup** — Supabase has no separate resend template, so
that one wording covers both the first email and every repeat. The remaining templates
(Magic link, Invite, Change email, Reauthentication) are left at their defaults because no
flow in the app triggers them.

## URLs the links depend on

The app signs up through `/auth/v1/signup` with no `emailRedirectTo` (`mobile/src/data/auth.ts`),
so every link lands on the project's **Site URL**. That is the public site on GitHub Pages,
not the admin console on Vercel:

- Site URL: `https://stephen316.github.io/DCU-Timetables/`
- Redirect allow-list: that URL with `**`, which covers the web app under `/app/` as well.

Supabase verifies the token itself and then redirects to that address carrying the session
in the URL *fragment* — `#access_token=...&refresh_token=...&type=signup` (or `type=recovery`).
A fragment never reaches a server, so it is read in the browser: `site/index.html` forwards
any URL carrying one to the app under `app/`, fragment intact, and `src/data/authLink.ts`
reads it there. An ordinary visit falls straight through to the page.

What the student sees: the link signs them in and sign-up carries on where it left off. A
reset link opens the new-password screen first. A link that has expired or been used lands
on sign-in with a line saying so.

A student who signed up inside the native app also lands on the website, since the app
sends no `emailRedirectTo` of its own. The address is confirmed either way, so they can
return to the app and sign in.

## Sending

The built-in Supabase sender only delivers to members of the organisation and is capped at
a couple of messages an hour, so student signups go nowhere until custom SMTP is set in
**Project Settings → Authentication → SMTP Settings**. Neither `github.io` nor `vercel.app`
can carry SPF/DKIM records, so a provider that demands a verified sending domain
(Resend, Postmark, Mailgun) can't send to `@mail.dcu.ie` addresses from here.

## Changing the Site URL later

Three places have to agree, or links go nowhere: the Site URL in the dashboard, the
forwarding script in `site/index.html`, and the Pages workflow that decides the app sits
under `app/`.
