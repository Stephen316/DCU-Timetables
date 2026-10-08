# Security policy

## Supported versions

Only the latest release on the App Store and the current `main` branch receive fixes.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/Stephen316/DCU-Timetables/security/advisories/new).
If you can't use that, email **stephenharcourt6@gmail.com** with "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. You
should hear back within a week. Once a fix ships, you'll be credited in the advisory unless
you'd rather not be.

## Scope

In scope:

- The iPhone app and its widgets (`mobile/`)
- The admin console (`web/`)
- Supabase row-level security, functions and policies (`supabase/`) — for example, reading
  another student's data, or writing reports or verdicts as someone else

Out of scope:

- DCU's own timetable service (`mytimetable.dcu.ie`) — report issues there to DCU
- The Supabase anon key and other `EXPO_PUBLIC_` values: they ship in the app bundle by
  design, and row-level security is what protects the data
- Denial of service, spam, and social engineering
