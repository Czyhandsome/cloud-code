export function createDangerousBackend() {
  throw new Error('Server mode disabled');
}
