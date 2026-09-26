import React from 'react';

type EffectRecord = {
  callback: () => void | (() => void);
  deps: any[] | undefined;
  cleanup: void | (() => void) | undefined;
};

export interface RenderResult {
  rerender: (newElement: React.ReactElement) => void;
  getByRole: (role: string) => any;
  getByLabelText: (label: string | RegExp) => any;
  getByTestId: (testId: string) => any;
  queryByTestId: (testId: string) => any;
  getByText: (matcher: string | RegExp) => any;
  queryByText: (matcher: string | RegExp) => any;
  findByText: (matcher: string | RegExp, options?: { timeout?: number; interval?: number }) => Promise<any>;
  findByTestId: (testId: string, options?: { timeout?: number; interval?: number }) => Promise<any>;
  UNSAFE_getByType: (type: any) => any;
  unmount: () => void;
}

export function render(element: React.ReactElement): RenderResult {
  let hookIndex = 0;
  const stateValues: any[] = [];
  const refValues: any[] = [];
  const memoValues: Array<{ value: any; deps: any[] | undefined }> = [];
  const effectRecords: EffectRecord[] = [];
  let pendingEffects: Array<() => void> = [];

  let currentElement = element;
  let vdom: any = null;
  let isDirty = false;

  const areDepsEqual = (prevDeps?: any[], nextDeps?: any[]): boolean => {
    if (!prevDeps || !nextDeps) return false;
    if (prevDeps.length !== nextDeps.length) return false;
    return prevDeps.every((dep, i) => Object.is(dep, nextDeps[i]));
  };

  const dispatcher = {
    useState: (initial: any) => {
      const idx = hookIndex++;
      if (stateValues[idx] === undefined) {
        stateValues[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = (next: any) => {
        const nextValue = typeof next === 'function' ? next(stateValues[idx]) : next;
        if (!Object.is(stateValues[idx], nextValue)) {
          stateValues[idx] = nextValue;
          isDirty = true;
        }
      };
      return [stateValues[idx], setState];
    },
    useRef: (initial: any) => {
      const idx = hookIndex++;
      if (refValues[idx] === undefined) {
        refValues[idx] = { current: initial };
      }
      return refValues[idx];
    },
    useMemo: (fn: any, deps?: any[]) => {
      const idx = hookIndex++;
      const existing = memoValues[idx];
      if (existing && areDepsEqual(existing.deps, deps)) {
        return existing.value;
      }
      const value = fn();
      memoValues[idx] = { value, deps };
      return value;
    },
    useCallback: (fn: any, deps?: any[]) => {
      const idx = hookIndex++;
      const existing = memoValues[idx];
      if (existing && areDepsEqual(existing.deps, deps)) {
        return existing.value;
      }
      memoValues[idx] = { value: fn, deps };
      return fn;
    },
    useEffect: (effect: () => void | (() => void), deps?: any[]) => {
      const idx = hookIndex++;
      const prev = effectRecords[idx];
      if (!prev || !areDepsEqual(prev.deps, deps)) {
        effectRecords[idx] = { callback: effect, deps, cleanup: prev?.cleanup };
        pendingEffects.push(() => {
          if (typeof prev?.cleanup === 'function') {
            prev.cleanup();
          }
          const cleanup = effect();
          const record = effectRecords[idx];
          if (record) {
            record.cleanup = cleanup;
          }
        });
      }
    },
    useLayoutEffect: (effect: () => void | (() => void), deps?: any[]) => {
      const idx = hookIndex++;
      const prev = effectRecords[idx];
      if (!prev || !areDepsEqual(prev.deps, deps)) {
        effectRecords[idx] = { callback: effect, deps, cleanup: prev?.cleanup };
        pendingEffects.push(() => {
          if (typeof prev?.cleanup === 'function') {
            prev.cleanup();
          }
          const cleanup = effect();
          const record = effectRecords[idx];
          if (record) {
            record.cleanup = cleanup;
          }
        });
      }
    },
    useSyncExternalStore: (_subscribe: any, getSnapshot: any) => {
      hookIndex++;
      return getSnapshot();
    },
    useId: () => {
      hookIndex++;
      return 'mock-id';
    },
    useReducer: (reducer: any, initialArg: any, init: any) => {
      const idx = hookIndex++;
      if (stateValues[idx] === undefined) {
        stateValues[idx] = init !== undefined ? init(initialArg) : initialArg;
      }
      const dispatch = (action: any) => {
        const nextValue = reducer(stateValues[idx], action);
        if (!Object.is(stateValues[idx], nextValue)) {
          stateValues[idx] = nextValue;
          isDirty = true;
        }
      };
      return [stateValues[idx], dispatch];
    },
    useContext: (context: any) => context?._currentValue,
    useTransition: () => [false, (cb: () => void) => cb()],
    useDeferredValue: (value: any) => value,
    useImperativeHandle: () => {},
    useDebugValue: () => {},
  };

  const renderNode = (node: any): any => {
    if (!node) return node;
    if (typeof node.type === 'function') {
      try {
        const rendered = node.type(node.props);
        return renderNode(rendered);
      } catch {
        return node;
      }
    }
    const children = node.props?.children;
    if (Array.isArray(children)) {
      return {
        ...node,
        props: {
          ...node.props,
          children: children.map(renderNode),
        },
      };
    } else if (children && typeof children === 'object') {
      return {
        ...node,
        props: {
          ...node.props,
          children: renderNode(children),
        },
      };
    }
    return node;
  };

  const executeRender = (el: React.ReactElement) => {
    hookIndex = 0;
    isDirty = false;
    const ReactSharedInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const prevDispatcher = ReactSharedInternals.ReactCurrentDispatcher.current;
    ReactSharedInternals.ReactCurrentDispatcher.current = dispatcher;

    try {
      const root = (el.type as any)(el.props);
      vdom = renderNode(root);
    } finally {
      ReactSharedInternals.ReactCurrentDispatcher.current = prevDispatcher;
    }
  };

  const flushEffects = () => {
    let iterations = 0;
    while ((pendingEffects.length > 0 || isDirty) && iterations < 20) {
      iterations++;
      const toRun = [...pendingEffects];
      pendingEffects = [];
      for (const eff of toRun) {
        eff();
      }
      if (isDirty) {
        executeRender(currentElement);
      }
    }
  };

  // Initial mount render
  executeRender(currentElement);
  flushEffects();

  const findByPredicate = (node: any, predicate: (n: any) => boolean): any => {
    if (!node) return null;
    if (predicate(node)) {
      return node;
    }
    const children = node.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = findByPredicate(child, predicate);
        if (found) return found;
      }
    } else if (children && typeof children === 'object') {
      return findByPredicate(children, predicate);
    }
    return null;
  };

  const matchesText = (text: any, matcher: string | RegExp): boolean => {
    if (text === null || text === undefined) return false;
    const str = String(text);
    if (typeof matcher === 'string') {
      return str.includes(matcher) || str.toLowerCase().includes(matcher.toLowerCase());
    }
    if (matcher instanceof RegExp) {
      return matcher.test(str);
    }
    return false;
  };

  const nodeMatchesText = (node: any, matcher: string | RegExp): boolean => {
    if (!node?.props) return false;
    if (node.props?.value !== undefined && node.props?.value !== null) {
      if (matchesText(node.props.value, matcher)) {
        return true;
      }
    }
    const children = node.props?.children;
    if (typeof children === 'string' || typeof children === 'number') {
      return matchesText(children, matcher);
    }
    if (Array.isArray(children)) {
      const textParts = children.filter((c) => typeof c === 'string' || typeof c === 'number');
      if (textParts.length > 0) {
        return matchesText(textParts.join(''), matcher);
      }
    }
    return false;
  };

  return {
    rerender: (newElement: React.ReactElement) => {
      currentElement = newElement;
      executeRender(currentElement);
      flushEffects();
    },
    getByRole: (role: string) => {
      if (isDirty) {
        executeRender(currentElement);
        flushEffects();
      }
      const found = findByPredicate(vdom, (node) => node?.props?.accessibilityRole === role);
      if (!found) {
        throw new Error(`Element with accessibilityRole "${role}" not found`);
      }
      return found;
    },
    getByLabelText: (label: string | RegExp) => {
      if (isDirty) {
        executeRender(currentElement);
        flushEffects();
      }
      const found = findByPredicate(vdom, (node) =>
        matchesText(node?.props?.accessibilityLabel, label)
      );
      if (!found) {
        throw new Error(`Element with accessibilityLabel "${label}" not found`);
      }
      return found;
    },
    getByTestId: (testId: string) => {
      if (isDirty) {
        executeRender(currentElement);
        flushEffects();
      }
      const found = findByPredicate(
        vdom,
        (node) => node?.props?.testID === testId || node?.props?.testId === testId
      );
      if (!found) {
        throw new Error(`Element with testID "${testId}" not found`);
      }
      return found;
    },
    queryByTestId: (testId: string) => {
      if (isDirty) {
        executeRender(currentElement);
        flushEffects();
      }
      return findByPredicate(
        vdom,
        (node) => node?.props?.testID === testId || node?.props?.testId === testId
      );
    },
    getByText: (matcher: string | RegExp) => {
      if (isDirty) {
        executeRender(currentElement);
        flushEffects();
      }
      const found = findByPredicate(vdom, (node) => nodeMatchesText(node, matcher));
      if (!found) {
        throw new Error(`Element with text "${matcher}" not found`);
      }
      return found;
    },
    queryByText: (matcher: string | RegExp) => {
      if (isDirty) {
        executeRender(currentElement);
        flushEffects();
      }
      return findByPredicate(vdom, (node) => nodeMatchesText(node, matcher));
    },
    findByText: async (
      matcher: string | RegExp,
      options?: { timeout?: number; interval?: number }
    ) => {
      const timeout = options?.timeout ?? 1000;
      const interval = options?.interval ?? 10;
      const start = Date.now();
      while (true) {
        if (isDirty) {
          executeRender(currentElement);
          flushEffects();
        }
        const found = findByPredicate(vdom, (node) => nodeMatchesText(node, matcher));
        if (found) {
          return found;
        }
        if (Date.now() - start >= timeout) {
          throw new Error(`Timed out waiting for element with text "${matcher}"`);
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    },
    findByTestId: async (
      testId: string,
      options?: { timeout?: number; interval?: number }
    ) => {
      const timeout = options?.timeout ?? 1000;
      const interval = options?.interval ?? 10;
      const start = Date.now();
      while (true) {
        if (isDirty) {
          executeRender(currentElement);
          flushEffects();
        }
        const found = findByPredicate(
          vdom,
          (node) => node?.props?.testID === testId || node?.props?.testId === testId
        );
        if (found) {
          return found;
        }
        if (Date.now() - start >= timeout) {
          throw new Error(`Timed out waiting for element with testID "${testId}"`);
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    },
    UNSAFE_getByType: (type: any) => {
      const found = findByPredicate(
        vdom,
        (node) =>
          node?.type === type ||
          (typeof type === 'string' &&
            (node?.type?.name === type || node?.type?.displayName === type))
      );
      if (!found) {
        throw new Error(`Element with type "${type}" not found`);
      }
      return found;
    },
    unmount: () => {
      for (const record of effectRecords) {
        if (typeof record?.cleanup === 'function') {
          record.cleanup();
        }
      }
    },
  };
}

export const act = (callback: () => void | Promise<void>): any => {
  const result = callback();
  return result;
};

export const fireEvent = {
  press: (node: any) => {
    if (node?.props?.onPress) {
      return node.props.onPress();
    }
  },
};

export const waitFor = async (
  callback: () => void | Promise<void>,
  { timeout = 1000, interval = 10 } = {}
): Promise<void> => {
  const start = Date.now();
  while (true) {
    try {
      await callback();
      return;
    } catch (err) {
      if (Date.now() - start >= timeout) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
};

export default {
  render,
  act,
  fireEvent,
  waitFor,
};
