import { z } from 'zod'

// SandboxManager stub - static class-like object
export const SandboxManager = {
  isSupportedPlatform() { return false },
  checkDependencies() { return { errors: [], warnings: [] } },
  async initialize(_config, callback) { if (callback) await callback() },
  updateConfig(_config) {},
  async reset() {},
  async wrapWithSandbox(_config, fn) { return fn() },
  getFsReadConfig() { return null },
  getFsWriteConfig() { return null },
  getNetworkRestrictionConfig() { return null },
  getIgnoreViolations() { return null },
  getAllowUnixSockets() { return null },
  getAllowLocalBinding() { return null },
  getEnableWeakerNestedSandbox() { return null },
  getProxyPort() { return null },
  getSocksProxyPort() { return null },
  getLinuxHttpSocketPath() { return null },
  getLinuxSocksSocketPath() { return null },
  async waitForNetworkInitialization() {},
  getSandboxViolationStore() { return new SandboxViolationStore() },
  annotateStderrWithSandboxFailures(_command, stderr) { return stderr },
  async cleanupAfterCommand() {},
}

export const SandboxRuntimeConfigSchema = z.object({}).passthrough()

export class SandboxViolationStore {
  add() {}
  getAll() { return [] }
  clear() {}
}
