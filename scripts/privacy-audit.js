/**
 * VoiceNote Automated Privacy Audit Script.
 * Strictly verifies zero network leaks, zero unauthorized storage, and minimal permissions.
 */
const fs = require('fs');
const path = require('path');

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function runAudit() {
  const srcDir = path.join(__dirname, '..', 'src');
  const allFiles = walkDir(srcDir).filter((f) => /\.(ts|tsx|js)$/.test(f));

  let violations = 0;

  // 1. Audit Network APIs
  const prohibitedNetworkRegex = /\b(fetch|axios|XMLHttpRequest)\b/g;
  for (const file of allFiles) {
    const relPath = path.relative(path.join(__dirname, '..'), file);
    // Only modelDownloader is permitted to have download logic
    if (relPath.includes('modelDownloader.ts') || relPath.includes('downloader.ts')) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    if (prohibitedNetworkRegex.test(content)) {
      console.error(`❌ Network API violation in ${relPath}: Found prohibited network call`);
      violations++;
    }
  }

  // 2. Audit AsyncStorage (MMKV required)
  const asyncStorageRegex = /@react-native-async-storage\/async-storage/g;
  for (const file of allFiles) {
    const relPath = path.relative(path.join(__dirname, '..'), file);
    const content = fs.readFileSync(file, 'utf8');
    if (asyncStorageRegex.test(content)) {
      console.error(`❌ Storage violation in ${relPath}: AsyncStorage found; MMKV required`);
      violations++;
    }
  }

  // 3. Audit console.log (logger required)
  const consoleLogRegex = /console\.log\(/g;
  for (const file of allFiles) {
    const relPath = path.relative(path.join(__dirname, '..'), file);
    const content = fs.readFileSync(file, 'utf8');
    if (consoleLogRegex.test(content)) {
      console.error(`❌ Console log violation in ${relPath}: console.log found; use logger utility`);
      violations++;
    }
  }

  // 4. Audit Android Permissions
  const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const permissions = manifestContent.match(/android\.permission\.[A-Z_]+/g) || [];
    const allowedPermissions = ['android.permission.RECORD_AUDIO'];
    for (const perm of permissions) {
      if (!allowedPermissions.includes(perm)) {
        console.error(`❌ Permission violation in AndroidManifest: ${perm} is not permitted`);
        violations++;
      }
    }
  }

  if (violations === 0) {
    console.log('✅ Privacy Audit Passed: Zero cloud calls, zero telemetry, minimal permissions.');
    process.exit(0);
  } else {
    console.error(`❌ Privacy Audit Failed with ${violations} violations.`);
    process.exit(1);
  }
}

runAudit();
