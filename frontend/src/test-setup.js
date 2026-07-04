import '@testing-library/jest-dom';

const stderrWrite = globalThis.process.stderr.write.bind(globalThis.process.stderr);
const stdoutWrite = globalThis.process.stdout.write.bind(globalThis.process.stdout);

const QUIET_TEST_OUTPUT_PATTERNS = [
  'Not implemented: navigation to another Document',
  'Error: Test error',
  '[CRM] 状态同步失败: Error: network',
];

function shouldHideKnownTestNoise(chunk) {
  const text = String(chunk ?? '');
  return QUIET_TEST_OUTPUT_PATTERNS.some((pattern) => text.includes(pattern));
}

globalThis.process.stderr.write = (chunk, encoding, callback) => {
  if (shouldHideKnownTestNoise(chunk)) {
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  }
  return stderrWrite(chunk, encoding, callback);
};

globalThis.process.stdout.write = (chunk, encoding, callback) => {
  if (shouldHideKnownTestNoise(chunk)) {
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  }
  return stdoutWrite(chunk, encoding, callback);
};

window.addEventListener('error', (event) => {
  if (event.error?.message === 'Test error') {
    event.preventDefault();
  }
});
