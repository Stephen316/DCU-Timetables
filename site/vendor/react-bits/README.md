# React Bits on the landing page

React Bits by David Haz. The upstream [licence](LICENSE.md) is included alongside
this notice.

## FoldText and GradientText heading

`site/src/react-bits/FoldText.jsx` and `FoldText.css` contain the user's supplied
React Bits FoldText JavaScript + CSS source. The component itself is unchanged
apart from its attribution comment. `site/src/heading.jsx` renders it directly
on “Your DCU timetable,” with React and GSAP: paper style, character splits, top hinge, scroll entrance,
92-degree fold, 0.65s duration and 0.045s stagger. Desktop pointer users also get
the supplied hover refold (140px radius, 45 degrees). Touch screens retain the entrance without pointer refolding. Narrow desktop
windows retain hover interaction. Reduced motion renders plain text
and responds immediately when the preference changes.

`GradientText.jsx` and `GradientText.css` contain the second user-supplied component,
unchanged apart from attribution. Only “personalised.” renders inside GradientText;
it is not a FoldText panel. It uses flow mode, a four-second cycle and 0.4 glow.
The palette uses the existing two violet accent tokens plus a highlight mixed
from 35% accent and 65% text. No additional dependency is needed. The component
stops its animation when offscreen; reduced motion removes both effects.

The existing heading owns typography and line wrapping. Static HTML remains visible when JavaScript is disabled
or the bundle cannot load. The accessible heading has one text equivalent.

To rebuild after editing the source, run `npm ci` and `npm run build` in `site/`.
Commit the generated `assets/heading.js`, `assets/heading.css` and
`assets/heading.js.LEGAL.txt` alongside the source. The existing deployment copies
these files directly, so it needs no additional build step or CDN. Dependencies
are pinned in `package-lock.json`. React, React DOM and Scheduler share the licence
in `site/vendor/react/LICENSE.txt`; bundled GSAP notices are in the generated legal
file.

## SpotlightCard feature cards

Source revision: `9d9c687dc4f55b23539aa5417b703078047efa74`.
[SpotlightCard source](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/content/Components/SpotlightCard/SpotlightCard.jsx).

`site/react-bits.js` and `site/react-bits.css` adapt the radial gradient and soft
falloff calculation to local pointer events and a CSS pseudo-element behind the
existing card content. The page's accent, surface and radius are retained.
Ambient movement, grain, flare, proximity tracking and border glow are omitted.
Reduced motion and touch disable the effect; narrow mouse-driven windows keep it.
