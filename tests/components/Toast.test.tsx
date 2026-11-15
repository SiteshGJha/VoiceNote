import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Toast } from '@/components/Toast';

describe('Toast Component', () => {
  const mockOnDismiss = jest.fn();
  const mockOnAction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when visible is false', () => {
    const { queryByText } = render(
      <Toast
        message="Copied to clipboard"
        visible={false}
        onDismiss={mockOnDismiss}
      />
    );
    expect(queryByText('Copied to clipboard')).toBeNull();
  });

  it('renders message, action button, and close icon when visible', () => {
    const { getByText } = render(
      <Toast
        message="Copied to clipboard — ready to paste"
        visible={true}
        actionLabel="View Note"
        onAction={mockOnAction}
        onDismiss={mockOnDismiss}
      />
    );

    expect(getByText('Copied to clipboard — ready to paste')).toBeTruthy();
    expect(getByText('View Note')).toBeTruthy();
    expect(getByText('✕')).toBeTruthy();
  });

  it('triggers onAction when action button is pressed', () => {
    const { getByText } = render(
      <Toast
        message="Copied to clipboard"
        visible={true}
        actionLabel="View Note"
        onAction={mockOnAction}
        onDismiss={mockOnDismiss}
      />
    );

    fireEvent.press(getByText('View Note'));
    expect(mockOnAction).toHaveBeenCalledTimes(1);
  });

  it('triggers onDismiss when close button ✕ is pressed', () => {
    const { getByText } = render(
      <Toast
        message="Copied to clipboard"
        visible={true}
        onDismiss={mockOnDismiss}
      />
    );

    fireEvent.press(getByText('✕'));
    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after duration expires', () => {
    render(
      <Toast
        message="Copied to clipboard"
        visible={true}
        duration={2000}
        onDismiss={mockOnDismiss}
      />
    );

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });
});
