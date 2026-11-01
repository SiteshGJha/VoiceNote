import { __smokeTest, getNativeBridgeStatus } from '@/native/smokeTest';
import { getRustCore, __setRustCoreInstance } from '@/native/rustCore';

interface GlobalWithNitro {
  NitroModules?: {
    createHybridObject: jest.Mock;
  };
  NitroModulesProxy?: {
    createHybridObject: jest.Mock;
  };
}

const testGlobal = globalThis as unknown as GlobalWithNitro;

describe('Native Module Smoke Test', () => {
  afterEach(() => {
    __setRustCoreInstance(null);
    delete testGlobal.NitroModules;
    delete testGlobal.NitroModulesProxy;
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

    testGlobal.NitroModules = {
      createHybridObject: jest.fn().mockReturnValue(mockNitroCore),
    };

    const rustCore = getRustCore();
    expect(rustCore?.getVersion()).toBe('0.1.0-native-test');
    expect(testGlobal.NitroModules.createHybridObject).toHaveBeenCalledWith('RustCore');
  });

  it('getRustCore prioritizes NitroModulesProxy if present', () => {
    const mockProxyCore = {
      getVersion: jest.fn().mockReturnValue('0.1.0-proxy-test'),
    };

    testGlobal.NitroModulesProxy = {
      createHybridObject: jest.fn().mockReturnValue(mockProxyCore),
    };

    const rustCore = getRustCore();
    expect(rustCore?.getVersion()).toBe('0.1.0-proxy-test');
    expect(testGlobal.NitroModulesProxy.createHybridObject).toHaveBeenCalledWith('RustCore');
  });

  it('getRustCore gracefully handles NitroModules throwing', () => {
    testGlobal.NitroModules = {
      createHybridObject: jest.fn().mockImplementation(() => {
        throw new Error('Native module not linked');
      }),
    };

    const rustCore = getRustCore();
    expect(rustCore?.getVersion()).toBe('0.1.0-mock');
  });

  it('smoke test returns fail and status returns unavailable when getVersion throws', () => {
    __setRustCoreInstance({
      getVersion: () => {
        throw new Error('Native crash');
      },
    });

    expect(__smokeTest()).toBe('fail');
    const status = getNativeBridgeStatus();
    expect(status.status).toBe('unavailable');
    expect(status.isNitroAvailable).toBe(false);
    expect(status.isAudioEngineReady).toBe(false);
    expect(status.isAsrBridgeReady).toBe(false);
    expect(status.isSlmBridgeReady).toBe(false);
    expect(status.rustCoreVersion).toBe('unavailable');
  });

  it('smoke test returns fail and status returns unavailable when version is unavailable', () => {
    __setRustCoreInstance({
      getVersion: () => 'unavailable',
    });

    expect(__smokeTest()).toBe('fail');
    const status = getNativeBridgeStatus();
    expect(status.status).toBe('unavailable');
    expect(status.isNitroAvailable).toBe(false);
    expect(status.rustCoreVersion).toBe('unavailable');
  });
});
