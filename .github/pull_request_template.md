## What this changes

<!-- One or two sentences. Link the issue it closes, e.g. "Closes #12". -->

## Why

<!-- The problem it solves, or what the user sees differently. -->

## How it was checked

<!-- Screenshots for UI changes. Which tests you added or ran. -->

## Checklist

- [ ] `scripts/ci.sh` passes for the parts I touched (`mobile`, `web`)
- [ ] Tests added or updated for logic changes
- [ ] Database changes are in a new `supabase/phaseN_*.sql` file, with row-level security
- [ ] Native change (new native module, entitlement, permission or widget Swift) — needs a new store build
- [ ] Docs updated if behaviour or setup changed
