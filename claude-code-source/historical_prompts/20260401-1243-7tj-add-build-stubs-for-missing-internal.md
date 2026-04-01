# Build Stubs for Missing Internal Modules

## Context
User followed README instructions to build Claude Code from source but encountered missing module errors. The npm package source map didn't include internal/private modules for disabled features.

## Request
Fix the build failures by creating stubs for all missing modules.

## Solution Approach
Systematically created stub implementations for:
1. Disabled internal features (daemon, bridge, server, SSH, assistant/Kairos modes)
2. Private npm packages (@ant/computer-use-mcp, @ant/computer-use-swift, @ant/computer-use-input, audio-capture-napi)
3. Internal tools and services (proactive, workflow, skill search, context collapse)
4. Documentation files (Claude API guides)
5. Missing exports (isReplBridgeActive in state.ts)

## Result
Build succeeded, producing dist/cli.js (23.2MB) that runs and shows version 2.1.88.
