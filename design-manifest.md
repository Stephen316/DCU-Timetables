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

Scope: `site/index.html` only. Direction: restrained student utility.
Kit: existing landing-page components plus source adaptations of React Bits
BlurText and SpotlightCard. Platform: responsive static website, touch, pointer
and keyboard, verified at 320, 390, 768 and 1440 CSS pixels.

The user explicitly selected React Bits and requested preservation of the colour
scheme, overall layout and functions. The existing kit, typography, spacing,
section order, phone showcase, controls and light/dark palette are retained.
No new product features, runtime dependencies or hosting build steps.

### Layout and components

| Section | Structure and focal point | Enhancement |
|---|---|---|
| Hero | Existing title, web-app action, supporting links and three-phone stage | BlurText word entrance on the title; one pass, 600ms per word, 80ms stagger, 10px travel |
| Features | Existing five cards and responsive grid; theme buttons stay in their card | SpotlightCard soft radial fill follows a desktop pointer behind the content |
| Get it / footer | Existing platform instructions, download links, closing action and copy-link control | Preserved |

The current breakpoints and narrow-screen stacking remain unchanged. No controls
move with the effects. Spotlight is disabled on touch, below 761px, and with
reduced motion. The heading remains static when animation is unsupported or
reduced motion is enabled; live preference changes cancel running animations.
Hidden documents stop the enhancements. Both effects are optional: content and
links remain available without JavaScript.

### Tokens and source adaptations

| Role | Light | Dark |
|---|---|---|
| Canvas | Existing `--bg`: #f6f5fb | Existing `--bg`: #131316 |
| Card | Existing `--card`: #ffffff | Existing `--card`: #1c1c21 |
| Text | Existing `--text`: #171717 | Existing `--text`: #fafafa |
| Supporting text | Existing `--muted`: #55526b | Existing `--muted`: #b4b1c7 |
| Effect colour | Existing `--accent`: #7c3aed | Existing `--accent`: #8b5cf6 |

New effect parameters are defined under `:root` in `site/react-bits.css`.
Spotlight opacity is 0.12; no new palette colours are introduced.

These are static DOM adaptations, not React imports. BlurText uses native Web
Animations in place of Motion; the original inline heading layout and a single
accessible text equivalent are preserved. SpotlightCard retains the upstream
falloff calculation and radial fill, using local, frame-batched pointer events.
Its ambient animation, grain, flare, proximity tracking and border glow are
omitted. A non-interactive pseudo-element puts the light behind existing content.
Source revision, upstream links and licence are in `site/vendor/react-bits/`.
The user's explicit motion request permits these React Bits effects within the
existing restrained design; no additional styling overrides are needed.

### Landing-page verification

| Check | Result |
|---|---|
| Syntax / patch | `node --check site/react-bits.js` and `git diff --check` passed; static site has no compilation or lint task |
| Layout | Hero, heading, stage, feature grid, download grid, final action and footer bounds match the pre-change page within 1px at all four widths; no horizontal overflow |
| Visual | Desktop and phone reviewed in both themes; desktop spotlight reviewed |
| Behaviour | Headline animation, live reduced-motion cancellation, desktop pointer effect, narrow-screen fallback, theme Enter activation, visible focus, persisted theme, screenshot theme changes, clipboard success and manual-copy fallback passed |
| Content | Every link destination unchanged; one accessible level-one heading; all five feature cards available with JavaScript disabled |
| Contrast | At peak spotlight: main text light 15.00:1 / dark 14.31:1, supporting text 6.26:1 / 7.15:1. Large accent heading 5.26:1 / 4.38:1 |
| Axe | Same findings as the pre-change page: 6 dark / 7 light contrast failures in existing controls, decorative badges and footer text. No new violations; existing colours retained as requested |
| Runtime | No browser errors; no continuous rendering loop or external asset requests added |
| Limitations | Chromium browser verification; physical touch devices, Safari and screen-reader speech not exercised. Existing accessibility findings remain outside this motion-only change |

The unrelated uncommitted phone-scroll changes in `site/index.html` are preserved
in the working tree and excluded from the React Bits commit.
