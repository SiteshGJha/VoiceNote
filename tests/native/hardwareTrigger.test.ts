import React from 'react';
import { render } from '@testing-library/react-native';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { hardwareTrigger, useHardwareTrigger } from '@/native/hardwareTrigger';
import { useSettingsStore } from '@/state/useSettingsStore';

// Component to test hook
const TestTriggerComponent: React.FC<{ onTrigger: () => void }> = ({ onTrigger }) => {
  useHardwareTrigger(onTrigger);
  return null;
};

describe('hardwareTrigger & useHardwareTrigger', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAllSettings();
  });

  it('safely handles missing NativeModules.VoiceNoteHardwareTrigger without throwing Invariant Violation', () => {
    // Ensure NativeModules.VoiceNoteHardwareTrigger is undefined (as on macOS / unsupported platform)
    delete (NativeModules as any).VoiceNoteHardwareTrigger;
    useSettingsStore.getState().setHardwareTriggerButton('volume');

    const onTrigger = jest.fn();

    // Rendering should not throw "new NativeEventEmitter() requires a non-null argument"
    expect(() => {
      render(React.createElement(TestTriggerComponent, { onTrigger }));
    }).not.toThrow();

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('safely sets button when NativeModules.VoiceNoteHardwareTrigger is undefined', async () => {
    delete (NativeModules as any).VoiceNoteHardwareTrigger;
    await expect(hardwareTrigger.setButton('volume')).resolves.not.toThrow();
  });

  it('subscribes and fires onTrigger on double press when native module exists', () => {
    const mockListeners: Record<string, (event: any) => void> = {};
    const mockRemove = jest.fn();

    (NativeModules as any).VoiceNoteHardwareTrigger = {
      setButton: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };

    // Spy on NativeEventEmitter addListener
    const addListenerSpy = jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockImplementation(
      (eventName: string, listener: any) => {
        mockListeners[eventName] = listener;
        return { remove: mockRemove } as any;
      }
    );

    useSettingsStore.getState().setHardwareTriggerButton('volume');
    const onTrigger = jest.fn();

    const { unmount } = render(React.createElement(TestTriggerComponent, { onTrigger }));

    expect(addListenerSpy).toHaveBeenCalledWith('VoiceNoteHardwareTrigger', expect.any(Function));

    // Simulate first hardware press
    const listener = mockListeners['VoiceNoteHardwareTrigger'];
    expect(listener).toBeDefined();

    listener?.({ button: 'volume' });
    expect(onTrigger).not.toHaveBeenCalled();

    // Simulate second hardware press within 400ms
    listener?.({ button: 'volume' });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Unmount should cleanup
    unmount();
    expect(mockRemove).toHaveBeenCalled();

    addListenerSpy.mockRestore();
    delete (NativeModules as any).VoiceNoteHardwareTrigger;
  });
});
