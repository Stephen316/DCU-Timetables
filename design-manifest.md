# Settings design manifest

Kit: the app's established Notra-themed React Native component kit (`mobile/src/ui/components.tsx`), Expo 57 / React Native 0.86 / React Native Web 0.21. This extends the existing adaptation, not a fresh import of Notra's web registry.
Palette: existing violet, neutral surfaces and semantic colours, in light and dark mode.
Direction: quiet, organised utility.
Platform: responsive web and shared iOS/Android components, with touch, pointer and keyboard input.

## Layout

- Settings uses grouped Appearance and About rows. Changes save immediately, so no redundant Save action.
- Account places identity first, then the shareable reporter ID, then account access. Deletion keeps its confirmation sheet.
- Notifications places delivery permission or availability before alert preferences. Supported web sessions retain their notification switches. Native sessions retain alert offsets.
- Export puts the timetable summary before export actions. Existing platform-specific file/Google priority is retained. Empty timetables offer Refresh classes.
- Desktop uses a left navigation column and a readable content column. Phones use four labelled tabs above independently scrolling content. Large text allows navigation to wrap. Existing bottom-navigation clearance and safe-area handling remain.

## Theme mapping

| Role | Light | Dark |
|---|---|---|
| Canvas | #F6F5FB | #131316 |
| Surface | #FFFFFF | #1C1C21 |
| Raised / selected navigation | #EFEDF9 | #26252D |
| Main text | #171717 | #FAFAFA |
| Supporting text | #55526B | #B4B1C7 |
| Accent / focus | #7C3AED | #8B5CF6 |
| Filled export action / selected alert | #7C3AED | #7C3AED |

Filled controls use the existing light violet in both modes so white labels reach 5.70:1. The original dark accent gives 4.23:1 with white, so it remains for icons and focus rather than those small filled labels. No global palette was changed.

## Components and adaptations

| Element | Origin | Adaptation |
|---|---|---|
| Navigation | App Icon, Txt, React Native Pressable | Labelled tabs; roving tab stop, arrows, Home/End, selected state and panel relationship on web; native accessibility state |
| Section | Existing app Section | Related rows share one surface with separators |
| Screen introduction | App Txt + theme spacing | Consistent heading and short description |
| Account | Existing AccountSheet | Optional settings/account filter, existing combined modal remains supported |
| Notifications | Existing NotificationsSheet | Inline presentation, grouped controls, clear unavailable/blocked guidance, 44pt alert choices |
| Export | Existing ExportCalendarCard and buttons | Inline presentation plus existing modal, empty-state refresh, local accessible action colour |

All new dimensions use the existing Space, Radius, Desktop and MIN_TARGET tokens. Existing application typography, icons, buttons, sheets and theme selection are retained. No dependencies or animation added. No user overrides.

## Verification

| Layer | Result |
|---|---|
| TypeScript | Full working tree passed. Isolated staged snapshot has the same three pre-existing onboarding errors as HEAD (`Services.plus` and two inferred parameter types), with no new errors. |
| Lint | `expo lint` passed |
| Web bundle | `expo export --platform web` passed |
| Behaviour tests | 13 existing calendar export and alert tests passed |
| Visual | All four sections inspected at phone and desktop sizes; light and dark reviewed; narrow 320px export inspected without horizontal overflow |
| Keyboard | ArrowRight and End move selection and focus; focus visibly outlined; normal tab/press interaction retained |
| Touch | Navigation measured 73 × 67 at 320px; alert choices minimum 44pt |
| Contrast | Body light 17.93:1 / dark 16.26:1; supporting text 7.49:1 / 8.13:1; filled action 5.70:1; focus on raised 4.93:1 / 3.58:1 |
| Source audit | New composition uses existing theme tokens, no new literal colours or dependencies |
| Limitations | Physical iOS/Android, large OS text, screen-reader output, live push delivery and Google authorization not exercised. Local preview has no notification provider or upcoming export events. Full axe scan not run; browser DOM semantics, layout bounds and keyboard checks used. |

Existing unrelated workspace edits are preserved outside this task's commit. UI validation includes the current working tree's pre-existing component styling.
