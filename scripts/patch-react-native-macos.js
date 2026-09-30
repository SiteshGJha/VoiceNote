/**
 * Patches react-native-macos to prevent AppKit crashes during bridge reload / redbox dismiss.
 */
const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'node_modules', 'react-native-macos', 'React', 'CoreModules', 'RCTRedBox.mm');

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  const faulty = `[[RCTKeyWindow() contentViewController] dismissViewController:self];`;
  const safe = `@try {
    if (self.presentingViewController != nil) {
      [[RCTKeyWindow() contentViewController] dismissViewController:self];
    }
  } @catch (NSException *exception) {
    // Avoid crashing if RedBox is dismissed when not presented
  }`;

  if (content.includes(faulty)) {
    content = content.replace(faulty, safe);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('✅ Successfully patched RCTRedBox.mm in react-native-macos');
  } else if (content.includes('self.presentingViewController != nil')) {
    console.log('ℹ️  RCTRedBox.mm is already patched');
  }
}
