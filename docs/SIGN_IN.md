# Sign-in (DCU email only)

Students sign in with a DCU address and a one-time code emailed by Supabase Auth. Verifying
the address is what proves they're a student — and it supplies their name, so nothing is
typed by hand.

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

**You must edit the email template**, or students get a magic *link* instead of a code and
sign-in can't complete:

1. Supabase → **Authentication → Email Templates → Magic Link**
2. Include the token in the body, e.g.
   `Your DCU Timetable code is {{ .Token }}`
3. Authentication → **Providers → Email**: ensure Email is enabled.

The built-in SMTP is rate-limited (a few emails per hour) — fine for development, but a real
launch needs a custom SMTP provider configured in Supabase.

### Restricting the domain server-side

The app validates the domain, but a client check is bypassable — someone could call the Auth
API directly. To enforce it for real, add an Auth Hook / trigger in Supabase that rejects
sign-ups whose email doesn't end in `@dcu.ie` or `@mail.dcu.ie`. Until then the domain rule
is a UI guard, not a security boundary.

## What's stored

Only the verified address and the Supabase user id, in `UserDefaults` — no password and no
access token, so there's no credential at rest. The trade-off: "signed in" is local state, so
it isn't tamper-proof on a jailbroken device. Keep the session token in the Keychain if you
later make authenticated writes.

## Effect on cancellation reports

`reporterID` is now the **Supabase user id** rather than a per-install UUID, so a report is
one vote per *person* — reinstalling no longer grants another vote.
