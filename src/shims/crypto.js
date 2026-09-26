'use strict';

const createHash = require('create-hash');
const createHmac = require('create-hmac');
const { Buffer } = require('buffer');

function randomBytes(size, cb) {
  const buf = Buffer.alloc(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else if (typeof global !== 'undefined' && global.crypto && global.crypto.getRandomValues) {
    global.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < size; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }

  if (typeof cb === 'function') {
    cb(null, buf);
  }
  return buf;
}

function randomFillSync(buffer, offset = 0, size) {
  const len = size !== undefined ? size : buffer.length - offset;
  const bytes = randomBytes(len);
  bytes.copy(buffer, offset);
  return buffer;
}

function randomFill(buffer, offset, size, cb) {
  if (typeof offset === 'function') {
    cb = offset;
    offset = 0;
    size = buffer.length;
  } else if (typeof size === 'function') {
    cb = size;
    size = buffer.length - offset;
  }
  randomFillSync(buffer, offset, size);
  if (typeof cb === 'function') {
    cb(null, buffer);
  }
}

module.exports = {
  createHash,
  createHmac,
  randomBytes,
  rng: randomBytes,
  pseudoRandomBytes: randomBytes,
  prng: randomBytes,
  randomFill,
  randomFillSync,
};
