module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './src',
        },
        extensions: ['.macos.tsx', '.macos.ts', '.ios.tsx', '.ios.ts', '.android.tsx', '.android.ts', '.tsx', '.ts', '.js', '.json'],
      },
    ],
  ],
};
