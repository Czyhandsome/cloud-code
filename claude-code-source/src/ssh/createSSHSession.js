export class SSHSessionError extends Error {}
export async function createSSHSession() {
  throw new Error('SSH mode disabled');
}
export async function createLocalSSHSession() {
  throw new Error('SSH mode disabled');
}
