import { CardInset, concentric, Radius, screenCorner, Space } from '../src/ui/theme';

describe('Corner concentricity', () => {
  test("an inner corner's radius is the outer one's less the gap, so both curve round one centre", () => {
    expect(concentric(47, Space.l)).toBe(31);
    // A dialog drawn round its buttons: their radius plus the inset gives the dialog's.
    expect(concentric(Radius.control + Space.xl, Space.xl)).toBe(Radius.control);
    expect(concentric(Radius.block, 1)).toBe(3);
  });

  test("a gap wider than the curve can't share its centre, so the inner shape keeps its own radius", () => {
    expect(concentric(16, Space.xl)).toBe(Radius.control);
    expect(concentric(10, 10, 4)).toBe(4);
  });

  test("only a phone with a home indicator has rounded screen corners to follow", () => {
    expect(screenCorner(34)).toBe(47);
    expect(screenCorner(0)).toBe(0);
  });
});

describe('The radius scale', () => {
  test('each container is its controls\' radius plus the padding they sit in', () => {
    expect(Radius.dialog).toBe(Radius.control + Space.xl);
    expect(Radius.panel).toBe(Radius.card + Space.l);
    // So the controls come out concentric.
    expect(concentric(Radius.panel, Space.l)).toBe(Radius.card);
  });

  test("a card is tighter than its padding allows, so what's inside keeps the control radius", () => {
    expect(Radius.card).toBeLessThan(Radius.control + CardInset.x);
    expect(concentric(Radius.card, CardInset.x)).toBe(Radius.control);
  });
});
