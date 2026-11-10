# Sign-in (DCU email only)

Students sign in with a DCU address and a password. Confirming the emailed link proves they
control that DCU address — and the address supplies their name, so nothing else is typed.

## Name from the address

`stephen.harcourt2@mail.dcu.ie` → **Stephen Harcourt**

- everything after `@` is ignored
- dots separate name parts
- a trailing disambiguation number is dropped (`harcourt2` → `harcourt`)

Only `@dcu.ie` and `@mail.dcu.ie` are accepted. `DCUEmail` compares the domain exactly, so
lookalikes like `dcu.ie.attacker.com` or `student.dcu.ie` are rejected — pinned by tests.

The class list is **surname-first** ("Harcourt Stephen") while addresses are
given-name-first, so the profile match compares name parts as a **set**, not in order.

## One-off Supabase setup

Sign-in is **email + password**:

- **Create account** → our `signup` Edge Function emails a link → the student opens it and
  presses **Confirm my account** → only then does the account exist, and they can sign in.
- **Sign in** → email + password.
- **Forgot password?** → Supabase emails a reset link.

Steps:

1. Authentication → **Providers → Email**: enable Email.
2. Authentication → **Sign In / Providers → Allow new users to sign up: OFF**. ⚠️ **This is
   what makes the DCU rule mean anything.** Accounts are created only by the `signup`
   function, after the student has proved they control the DCU mailbox (below). Left on,
   anyone could still call `POST /auth/v1/signup` directly — claiming
   `someone.else@dcu.ie` without ever receiving mail there — and an unconfirmed row would be
   stored. Switching it off does not affect the function (it uses the admin API) or sign-in
   and password reset for existing accounts.
3. Set a minimum password length under Authentication → Policies if you want more than
   Supabase's default of 6 (the app asks for 8 when creating an account).

The password-reset email still comes from Supabase's template. The confirmation email is sent
by the function, so `supabase/templates/confirm-signup.html` is no longer used.

### Verify before an account exists

Supabase's own sign-up stores the account before the link is clicked, so an address nobody
proved they own would sit in `auth.users`. Instead:

1. The app calls the **`signup`** Edge Function (`supabase/functions/signup`) with the
   address and password. It checks the DCU rule, stores a *pending* row in
   `pending_signups` (password encrypted, link token kept only as a hash) and emails a link
   to `app.dculive.ie/signup#t=…`. Nothing is written to `auth.users`.
2. The link opens `mobile/public/verify.html` (`mobile/vercel.json` serves it at `/signup`;
   `/verify.html` still works for links sent before that), which shows a **Confirm my account** button.
   Mail scanners (Defender Safe Links on `@mail.dcu.ie`) GET every link in a message, so
   the link itself changes nothing — only the button's POST does.
3. The POST makes the function create the account with `email_confirm: true`, delete the
   pending row, and the student presses Continue in the app.

Pending rows last an hour and are swept every ten minutes (pg_cron). The same job clears any
unconfirmed accounts left by the old route.

Set up, once:

1. Run `supabase/phase50_verify_before_account.sql`.
2. Create a Resend account (free tier), verify a sending domain, and make an API key.
3. Set the function's secrets (Edge Functions → Secrets), generating the key with
   `openssl rand -base64 32`:
   `RESEND_API_KEY`, `MAIL_FROM` (e.g. `DCU Live <accounts@your-domain>`), `SIGNUP_ENC_KEY`.
4. Deploy with JWT verification off (a signed-out student calls it):
   `supabase functions deploy signup --no-verify-jwt`
5. Switch **Allow new users to sign up** OFF (step 2 above) — last, once the function works.

Check: create an account in the app, confirm that no row appears in `auth.users` until the
button is pressed, and that `POST /auth/v1/signup` now answers "Signups not allowed".

Same address, second time: no second link — the person is emailed that they already have an
account, and the app's answer is identical, so it can't be used to learn who is registered.
A repeat request within a minute sends nothing.

Resend's free tier caps emails per day and per month; check its current limits before a launch
where a whole cohort signs up at once. Supabase's built-in SMTP (still used for password
resets) is far tighter — a few emails per hour — so a real launch also wants custom SMTP there.

### Restricting the domain server-side

The app validates the domain, but a client check is bypassable — someone could call the Auth
API directly. Two server-side layers enforce it:

1. `supabase/phase0_identity.sql` §11 — the **Before User Created** hook, which must be
   switched on in the dashboard (Authentication → Hooks).
2. `supabase/phase45_dcu_email_enforced.sql` — a trigger on `auth.users` that rejects any
   insert, or any change of address, to a non-DCU email. This closes the
   `PUT /auth/v1/user {"email": ...}` route and backstops the hook if it is ever disabled.

Addresses outside the domain (console admin, App Review demo) go in `auth_domain_exceptions`.
Also keep **anonymous sign-ins** and **Phone** switched off in the dashboard.

## What's stored

The verified address and the Supabase user id in the app's device storage, and the
session tokens in the Keychain (`expo-secure-store`, this-device-only). No password is ever
stored.

## Effect on cancellation reports

`reporterID` is now the **Supabase user id** rather than a per-install UUID, so a report is
one vote per *person* — reinstalling no longer grants another vote.
