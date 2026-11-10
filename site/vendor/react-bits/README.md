# React Bits on the landing page

React Bits by David Haz. The upstream [licence](LICENSE.md) is included alongside
this notice.

## FoldText heading

`site/src/react-bits/FoldText.jsx` and `FoldText.css` contain the user's supplied
React Bits FoldText JavaScript + CSS source. The component itself is unchanged
apart from its attribution comment. `site/src/heading.jsx` renders it directly
with React and GSAP: paper style, character splits, top hinge, scroll entrance,
92-degree fold, 0.65s duration and 0.045s stagger. Desktop pointer users also get
the supplied hover refold (140px radius, 45 degrees). Touch and narrow screens
retain the entrance without pointer refolding. Reduced motion renders plain text
and responds immediately when the preference changes.

The existing heading owns typography and line wrapping. The final word uses the
existing violet accent. Static HTML remains visible when JavaScript is disabled
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
Reduced motion, touch and narrow viewports disable the effect.
