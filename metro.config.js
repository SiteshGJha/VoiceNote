const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const nodeLibs = require('node-libs-react-native');
const path = require('path');

/**
 * Metro configuration for VoiceNote
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    extraNodeModules: {
      ...nodeLibs,
      crypto: path.resolve(__dirname, 'src/shims/crypto.js'),
      fs: path.resolve(__dirname, 'src/shims/fs.js'),
    },
  },
  server: {
    enhanceMiddleware: (metroMiddleware) => {
      return (req, res, next) => {
        if (req.url && req.url.startsWith('/symbolicate') && req.method === 'POST') {
          if (req.rawBody) {
            return metroMiddleware(req, res, next);
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            const trimmed = body.trim();
            let safeBody = trimmed;
            try {
              if (!trimmed) {
                safeBody = '{"stack":[]}';
              } else {
                JSON.parse(trimmed);
              }
            } catch {
              safeBody = '{"stack":[]}';
            }
            req.rawBody = Promise.resolve(safeBody);
            metroMiddleware(req, res, next);
          });
          req.on('error', () => {
            req.rawBody = Promise.resolve('{"stack":[]}');
            metroMiddleware(req, res, next);
          });
        } else {
          metroMiddleware(req, res, next);
        }
      };
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
