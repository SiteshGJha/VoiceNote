import { __smokeTest, getNativeBridgeStatus } from '@/native/smokeTest';
import { getRustCore, __setRustCoreInstance } from '@/native/rustCore';

describe('Native Module Smoke Test', () => {
  afterEach(() => {
    __setRustCoreInstance(null);
  });

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

  it('reports rustCoreVersion', () => {
    const status = getNativeBridgeStatus();
    expect(status.rustCoreVersion).toBeDefined();
    expect(typeof status.rustCoreVersion).toBe('string');
    expect(status.rustCoreVersion).toBe('0.1.0-mock');
  });

  it('getRustCore provides getVersion() contract', () => {
    const rustCore = getRustCore();
    expect(rustCore).not.toBeNull();
    expect(typeof rustCore?.getVersion).toBe('function');
    expect(rustCore?.getVersion()).toBe('0.1.0-mock');
  });

  it('getRustCore integrates with NitroModules if present', () => {
    const mockNitroCore = {
      getVersion: jest.fn().mockReturnValue('0.1.0-native-test'),
    };

    (global as any).NitroModules = {
      createHybridObject: jest.fn().mockReturnValue(mockNitroCore),
    };

    try {
      const rustCore = getRustCore();
      expect(rustCore?.getVersion()).toBe('0.1.0-native-test');
      expect((global as any).NitroModules.createHybridObject).toHaveBeenCalledWith('RustCore');
    } finally {
      delete (global as any).NitroModules;
    }
  });

  it('getRustCore gracefully handles NitroModules throwing', () => {
    (global as any).NitroModules = {
      createHybridObject: jest.fn().mockImplementation(() => {
        throw new Error('Native module not linked');
      }),
    };

    try {
      const rustCore = getRustCore();
      expect(rustCore?.getVersion()).toBe('0.1.0-mock');
    } finally {
      delete (global as any).NitroModules;
    }
  });
});
