/**
 * Double-Press Detector.
 * Pure TypeScript utility to detect double press events within a given time window (default 400ms).
 */
export class DoublePressDetector {
  private lastPressTimestamp: number = 0;
  private readonly windowMs: number;
  private isDebounced: boolean = false;

  constructor(windowMs: number = 400) {
    this.windowMs = windowMs;
  }

  /**
   * Processes a press event at a given timestamp (default Date.now()).
   * Returns true if this press completes a valid double press.
   */
  public press(timestamp: number = Date.now()): boolean {
    if (this.isDebounced) {
      this.isDebounced = false;
      this.lastPressTimestamp = 0;
      return false;
    }

    const delta = timestamp - this.lastPressTimestamp;
    if (this.lastPressTimestamp > 0 && delta <= this.windowMs && delta > 0) {
      // Valid double press detected!
      this.isDebounced = true;
      this.lastPressTimestamp = 0;
      return true;
    }

    this.lastPressTimestamp = timestamp;
    return false;
  }

  public reset(): void {
    this.lastPressTimestamp = 0;
    this.isDebounced = false;
  }
}
