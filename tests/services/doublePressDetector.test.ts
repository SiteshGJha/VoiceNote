import { DoublePressDetector } from '@/services/doublePressDetector';

describe('DoublePressDetector', () => {
  let detector: DoublePressDetector;

  beforeEach(() => {
    detector = new DoublePressDetector(400);
  });

  it('single press does not trigger', () => {
    expect(detector.press(1000)).toBe(false);
  });

  it('two presses within 400ms window triggers true', () => {
    expect(detector.press(1000)).toBe(false);
    expect(detector.press(1250)).toBe(true);
  });

  it('two presses separated by more than 400ms do not trigger', () => {
    expect(detector.press(1000)).toBe(false);
    expect(detector.press(1500)).toBe(false);
  });

  it('debounces third press occurring immediately after double press', () => {
    expect(detector.press(1000)).toBe(false);
    expect(detector.press(1200)).toBe(true);
    // Third press 100ms later should not trigger another double-press
    expect(detector.press(1300)).toBe(false);
  });

  it('resets correctly on explicit reset call', () => {
    detector.press(1000);
    detector.reset();
    expect(detector.press(1100)).toBe(false);
  });
});
