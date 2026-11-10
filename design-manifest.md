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

## Public landing page: React Bits

Scope: `site/index.html`. Direction: restrained student utility.
Kit: existing landing-page components, supplied React Bits FoldText and a
SpotlightCard source adaptation. Platform: responsive static website with a React
heading island, touch, pointer and keyboard, 320–1440 CSS pixels.

The user requested React Bits while retaining the colour scheme, overall layout
and functions, then supplied FoldText and changed the final word to personalised.
The heading now reads “Your DCU timetable, personalised.” The existing typography,
section order, phone showcase, controls and light/dark palette remain. The longer
word wraps naturally on phones; animated and static versions occupy the same space.

### Components

| Section | Implementation |
|---|---|
| Hero | Supplied FoldText React component, paper style, character splits, top hinge, scroll entrance, 92-degree fold, 0.65s duration and 0.045s stagger. “personalised.” inherits the existing accent |
| Desktop heading hover | Supplied refold interaction: 140px radius, 45 degrees; disabled on touch and below 761px |
| Features | Existing five-card grid and SpotlightCard soft radial fill; theme controls preserved |
| Get it / footer | Existing device instructions, links, closing action and copy-link control |

### Tokens and integration

| Role | Light | Dark |
|---|---|---|
| Canvas | Existing `--bg`: #f6f5fb | Existing `--bg`: #131316 |
| Card | Existing `--card`: #ffffff | Existing `--card`: #1c1c21 |
| Text | Existing `--text`: #171717 | Existing `--text`: #fafafa |
| Supporting text | Existing `--muted`: #55526b | Existing `--muted`: #b4b1c7 |
| Accent | Existing `--accent`: #7c3aed | Existing `--accent`: #8b5cf6 |

FoldText's source and CSS are copied from the user's attachment, with attribution.
The wrapper passes inherited font size, weight, line height and letter spacing;
its final word receives the existing accent. The component's original crease
shading remains. There are no new palette colours or structural styling changes.
This explicitly requested fold motion is the single headline effect; BlurText was
removed. SpotlightCard remains the previously documented static DOM adaptation.

React 19.2.3, React DOM 19.2.3 and GSAP 3.14.2 are locally bundled with esbuild
0.25.12. Source, lockfile, generated assets and licence notices are committed.
`npm --prefix site run build` regenerates the bundle; GitHub Pages continues to
copy the static site without an extra build step. The heading bundle is about
307 KiB before compression. No third-party CDN or runtime network request is needed.

Reduced motion renders a plain heading and cancels FoldText via unmount when
changed live. Static HTML remains readable if JavaScript or its bundle is blocked.
The supplied component provides a single screen-reader text equivalent and hides
its visual character panels from assistive technology. Hover is decorative and
never required to access information or controls.

### Verification

| Check | Result |
|---|---|
| Build / syntax | Production esbuild bundle and `node --check site/react-bits.js` passed; no lint task configured for the static site |
| Layout | Animated and plain versions of the updated heading and surrounding sections match within 1px at 320, 390, 768 and 1440px; no horizontal overflow |
| Visual | Desktop paper fold, hover refold and phone heading reviewed; light/dark screenshots captured |
| Behaviour | Character unfolding, desktop hover refold and recovery, narrow-screen hover suppression, live reduced-motion fallback and blocked-bundle/no-JavaScript fallbacks passed |
| Accessibility | One accessible level-one heading and unchanged accent; prior landing-page contrast findings remain unchanged in existing controls, decorative badges and footer |
| Runtime | No browser errors |
| Limits | Chromium verification; physical devices, Safari and screen-reader speech not exercised |

The unrelated uncommitted phone-scroll changes in `site/index.html` remain in the
working tree and are excluded from this task's commit.
