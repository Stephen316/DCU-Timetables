import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import FoldText from './react-bits/FoldText';
import './heading.css';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktopPointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 761px)');
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

  // kit-design: composed from the supplied React Bits FoldText and existing
  // heading tokens. Preserve typography and use the paper/top configuration.
  return (
    <FoldText
      text="Your DCU timetable, personalised."
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
      style={{ lineHeight: 'inherit', letterSpacing: 'inherit', whiteSpace: 'normal' }}
    />
  );
}

const heading = document.querySelector('[data-fold-heading]');
if (heading) createRoot(heading).render(<Heading />);
