import { __smokeTest, getNativeBridgeStatus } from '@/native/smokeTest';

describe('Native Module Smoke Test', () => {
  it('passes the required JSI native smoke test per Rule 05', () => {
    expect(__smokeTest()).toBe('ok');
  });

  it('reports native bridge subsystems as ready', () => {
    const status = getNativeBridgeStatus();
    expect(status.isNitroAvailable).toBe(true);
    expect(status.isAsrBridgeReady).toBe(true);
    expect(status.isSlmBridgeReady).toBe(true);
    expect(status.status).toBe('ok');
  });
});
