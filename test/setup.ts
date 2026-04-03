// Silence console output in all tests to reduce noise.
// Tests that need to verify console output should spy on specific methods.
beforeAll(() => {
  jest.spyOn(console, 'debug').mockImplementation();
  jest.spyOn(console, 'info').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
