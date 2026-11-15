let clipboardContent = '';

export const Clipboard = {
  setString: jest.fn((content: string) => {
    clipboardContent = content;
  }),
  getString: jest.fn(async () => clipboardContent),
  hasString: jest.fn(async () => clipboardContent.length > 0),
  // Helper for test assertions
  __getContent: () => clipboardContent,
  __reset: () => {
    clipboardContent = '';
    Clipboard.setString.mockClear();
    Clipboard.getString.mockClear();
    Clipboard.hasString.mockClear();
  },
};

export default Clipboard;
