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

- **Create account** → Supabase emails a confirmation link → the student confirms → they can
  sign in.
- **Sign in** → email + password.
- **Forgot password?** → Supabase emails a reset link.

Steps:

1. Authentication → **Providers → Email**: enable Email.
2. Authentication → **Providers → Email → Confirm email: ON**. ⚠️ **This is what makes the
   DCU rule mean anything.** With confirmations off, anyone could sign up as
   `someone.else@dcu.ie` without ever receiving mail at that address, and the domain check
   would be decoration. With it on, an account only works once the student has proved they
   control the DCU mailbox.
3. Set a minimum password length under Authentication → Policies if you want more than
   Supabase's default of 6 (the app asks for 8 when creating an account).

No email-template editing is needed — the default confirmation and recovery templates both
send links, which is exactly what this flow uses.

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
