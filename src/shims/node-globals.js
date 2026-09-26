// Safe Node.js globals polyfill for React Native
import { Platform } from 'react-native';

if (typeof global.process === 'undefined') {
  global.process = {};
}

if (!global.process.version) {
  global.process.version = 'v18.0.0';
}

if (!global.process.versions) {
  global.process.versions = {
    node: '18.0.0',
    v8: '10.0.0',
    modules: '108',
  };
}

if (typeof global.process.browser === 'undefined') {
  global.process.browser = true;
}

if (!global.process.platform) {
  global.process.platform = Platform.OS === 'macos' || Platform.OS === 'ios' ? 'darwin' : 'android';
}

if (!global.process.nextTick) {
  global.process.nextTick = (fn, ...args) => {
    setTimeout(() => fn(...args), 0);
  };
}

if (!global.process.cwd) {
  global.process.cwd = () => '/';
}

if (typeof global.Buffer === 'undefined') {
  try {
    global.Buffer = require('buffer').Buffer;
  } catch {}
}
