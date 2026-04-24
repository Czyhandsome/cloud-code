# 20260424-1034-qpo — Fix SandboxManager annotateStderrWithSandboxFailures crash

## Original prompt (reconstructed)

User ran `claude2` and asked it to draw a cat. The `generate-image` skill tried to run a `python3` command via Bash. The Bash tool crashed with:

> SandboxManager2.annotateStderrWithSandboxFailures is not a function. (In 'SandboxManager2.annotateStderrWithSandboxFailures(input.command, result.stdout || "")', 'SandboxManager2.annotateStderrWithSandboxFailures' is undefined)

## What was done

Traced through the bundle to find that `SandboxManager` in the compiled binary came from `stubs/@anthropic-ai/sandbox-runtime/index.js`, not the full `dist/sandbox/sandbox-manager.js`. The stub's `index.js` was the package entry point (per `exports` in `package.json`) and contained only ~10 methods. The `sandbox-adapter.ts` adapter object directly assigns `BaseSandboxManager.annotateStderrWithSandboxFailures` and 10 other methods from `BaseSandboxManager` — all `undefined` if missing from the stub.

Added all missing methods with safe no-op or pass-through stubs to `stubs/@anthropic-ai/sandbox-runtime/index.js`. Also patched `node_modules/@anthropic-ai/sandbox-runtime/index.js` directly (hard-linked to pnpm store, so one write covered both).

Rebuilt and reinstalled the binary.
