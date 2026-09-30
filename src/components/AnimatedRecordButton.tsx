import React, { useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
  View,
} from 'react-native';
import { useSystemTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';

interface AnimatedRecordButtonProps {
  isRecording: boolean;
  isProcessing: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export const AnimatedRecordButton: React.FC<AnimatedRecordButtonProps> = ({
  isRecording,
  isProcessing,
  onPress,
  disabled = false,
}) => {
  const theme = useSystemTheme();

  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  // Pulse animation when recording
  useEffect(() => {
    if (!isRecording) {
      pulseScale.setValue(1);
      pulseOpacity.setValue(0.6);
      return;
    }

    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.35,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1.0,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: 0.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.6,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    pulse.start();
    return () => pulse.stop();
  }, [isRecording, pulseScale, pulseOpacity]);

  // Spin animation when processing
  useEffect(() => {
    if (!isProcessing) {
      spinAnim.setValue(0);
      return;
    }

    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    );

    spin.start();
    return () => spin.stop();
  }, [isProcessing, spinAnim]);

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      {isRecording && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              backgroundColor: theme.recordActive,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
      )}

      {isProcessing && (
        <Animated.View
          style={[
            styles.spinRing,
            {
              borderColor: theme.primary,
              borderTopColor: 'transparent',
              transform: [{ rotate: spinInterpolate }],
            },
          ]}
        />
      )}

      <TouchableOpacity
        style={[
          styles.button,
          {
            backgroundColor: isRecording ? theme.recordActive : theme.primary,
            shadowColor: isRecording ? theme.recordActive : theme.primary,
          },
        ]}
        onPress={onPress}
        onPressIn={() => {
          // Immediately trigger haptic feedback on touch down
          if (!disabled && !isProcessing && !isRecording) {
            haptics.trigger('impactHeavy');
          }
        }}
        disabled={disabled || isProcessing}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
      >
        <Text style={styles.buttonIcon}>{isRecording ? '⏹' : '🎙'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
  },
  pulseRing: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  spinRing: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 3,
  },
  button: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonIcon: {
    fontSize: 30,
    color: '#FFFFFF',
  },
});
