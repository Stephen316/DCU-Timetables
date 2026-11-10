import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import FoldText from './react-bits/FoldText';
import GradientText from './react-bits/GradientText';
import './heading.css';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// A narrow desktop preview still has a mouse; gate on input, not width.
const desktopPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const subscribe = callback => {
  reducedMotion.addEventListener('change', callback);
  desktopPointer.addEventListener('change', callback);
  return () => {
    reducedMotion.removeEventListener('change', callback);
    desktopPointer.removeEventListener('change', callback);
  };
};

function Heading() {
  const reduce = useSyncExternalStore(subscribe, () => reducedMotion.matches);
  const refold = useSyncExternalStore(subscribe, () => desktopPointer.matches);

  if (reduce) return <>Your DCU timetable, <em>personalised.</em></>;

  // kit-design: composed from the supplied React Bits FoldText and GradientText.
  // kit-design: user override — separate FoldText and GradientText effects in
  // one heading, as requested. Typography and palette remain inherited.
  return (
    <>
      <FoldText
        text="Your DCU timetable,"
        foldStyle="paper"
        splitBy="char"
        hinge="top"
        trigger="scroll"
        foldAngle={92}
        duration={0.65}
        stagger={0.045}
        staggerFrom="start"
        ease="power3.out"
        hoverRefold={refold}
        refoldRadius={140}
        refoldAngle={45}
        perspective={700}
        creaseShading={0.55}
        fontSize="inherit"
        fontWeight="inherit"
        style={{ display: 'inline', lineHeight: 'inherit', letterSpacing: 'inherit', whiteSpace: 'normal' }}
      />
      {' '}
      <GradientText
        colors={['var(--accent)', 'var(--heading-gradient-highlight)', 'var(--accent-2)']}
        animationSpeed={4}
        variant="flow"
        scale={1.5}
        glow={0.4}
      >
        personalised.
      </GradientText>
    </>
  );
}

const heading = document.querySelector('[data-fold-heading]');
if (heading) createRoot(heading).render(<Heading />);
