import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Waveform } from '@/components/Waveform';

describe('Waveform Animation Optimisation', () => {
  it('resets bars immediately when isRecording switches from true to false', () => {
    const { rerender, getByRole } = render(
      <Waveform amplitude={0.8} isRecording={true} />
    );
    rerender(<Waveform amplitude={0.0} isRecording={false} />);
    // All bars should be at baseline 0.1 height (4px rendered) immediately
    const container = getByRole('image');
    // inspect children — all heights should equal 4 (floor of 0.1 * 48)
    container.props.children.forEach((child: any) => {
      expect(child.props.style.find((s: any) => s.height !== undefined).height).toBe(4);
    });
  });

  it('renders baseline bars with height 4 when idle', () => {
    const { getByRole } = render(
      <Waveform amplitude={0.0} isRecording={false} barCount={28} />
    );
    const container = getByRole('image');
    expect(container.props.children).toHaveLength(28);
    container.props.children.forEach((child: any) => {
      expect(child.props.style.find((s: any) => s.height !== undefined).height).toBe(4);
    });
  });

  it('supports custom barCount prop', () => {
    const { getByRole } = render(
      <Waveform amplitude={0.5} isRecording={false} barCount={16} />
    );
    const container = getByRole('image');
    expect(container.props.children).toHaveLength(16);
    container.props.children.forEach((child: any) => {
      expect(child.props.style.find((s: any) => s.height !== undefined).height).toBe(4);
    });
  });

  it('applies deterministic low-pass filter on amplitude changes without jitter', () => {
    const { rerender, getByRole } = render(
      <Waveform amplitude={0.0} isRecording={true} barCount={10} />
    );
    // Baseline bar is 0.1. Next with amplitude 0.8:
    // height = min(1.0, max(0.1, 0.1 * 0.7 + 0.8 * 0.3)) = 0.07 + 0.24 = 0.31
    // barHeight = max(4, floor(0.31 * 48)) = max(4, floor(14.88)) = 14
    rerender(<Waveform amplitude={0.8} isRecording={true} barCount={10} />);
    const container = getByRole('image');
    const children = container.props.children;
    const lastChild = children[children.length - 1];
    const lastHeight = lastChild.props.style.find((s: any) => s.height !== undefined).height;
    expect(lastHeight).toBe(14);
  });
});
