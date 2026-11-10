# React Bits landing-page adaptations

Source: [React Bits](https://reactbits.dev), David Haz, revision
`9d9c687dc4f55b23539aa5417b703078047efa74`.
The upstream [licence](LICENSE.md) is included alongside this notice.

- [BlurText](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/content/TextAnimations/BlurText/BlurText.jsx): word staggering and three blur/opacity/translation states, adapted to the Web Animations API. Retains a single accessible heading and the original inline word wrapping. Runs once, with smaller travel and no looping, hover replay or spring.
- [SpotlightCard](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/content/Components/SpotlightCard/SpotlightCard.jsx): radial gradient and soft falloff calculation, adapted to local pointer events and a CSS pseudo-element behind the existing card content. Uses the landing page's accent, surface and radius. Ambient movement, grain, flare, proximity tracking and border glow are omitted.

Implementation: `site/react-bits.js` and `site/react-bits.css`. These are static-site
adapters of the named source components, not React component imports. No React,
Motion or build step is required by the existing GitHub Pages site. Effects are
optional enhancements: all content and controls remain in HTML. Reduced motion
disables both effects; touch and narrow viewports omit the pointer effect.
