// Safe React Native & Node cross-platform shim for fs
const EventEmitter = require('events');

const memFiles = new Map();

function existsSync(filePath) {
  if (typeof filePath !== 'string') return false;
  return memFiles.has(filePath) || filePath.length > 0;
}

function mkdirSync(dirPath, options) {
  return dirPath;
}

function writeFileSync(filePath, data) {
  memFiles.set(filePath, data);
}

function unlinkSync(filePath) {
  memFiles.delete(filePath);
}

function copyFileSync(src, dest) {
  const content = memFiles.get(src) || '';
  memFiles.set(dest, content);
}

function statSync(filePath) {
  const content = memFiles.get(filePath) || '';
  return {
    size: typeof content === 'string' ? content.length : (content.byteLength || 0),
    isFile: () => true,
    isDirectory: () => false,
  };
}

function readFileSync(filePath, encoding) {
  return memFiles.get(filePath) || '';
}

function createReadStream(filePath) {
  const stream = new EventEmitter();
  stream.pause = () => stream;
  stream.resume = () => stream;
  stream.pipe = (dest) => dest;
  stream.destroy = () => {};
  
  setTimeout(() => {
    stream.emit('data', Buffer.from(memFiles.get(filePath) || 'mock_file_content'));
    stream.emit('end');
    stream.emit('close');
  }, 10);
  
  return stream;
}

function createWriteStream(filePath) {
  const stream = new EventEmitter();
  const chunks = [];
  stream.write = (chunk) => {
    chunks.push(chunk);
    return true;
  };
  stream.end = (chunk) => {
    if (chunk) chunks.push(chunk);
    memFiles.set(filePath, Buffer.concat(chunks));
    stream.emit('finish');
    stream.emit('close');
  };
  stream.destroy = () => {};
  return stream;
}

module.exports = {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  copyFileSync,
  statSync,
  readFileSync,
  createReadStream,
  createWriteStream,
};
