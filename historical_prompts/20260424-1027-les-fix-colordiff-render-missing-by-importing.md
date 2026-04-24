# 20260424-1027-les — Fix ColorDiff render crash

## Original prompt

> claude2
>
> ERROR new ColorDiff2(patch, firstLine, filePath, fileContent).render is not a function. (In 'new ColorDiff2(...).render(theme, width, dim2)', 'new ColorDiff2(...).render' is undefined)
>
> The "make install"ed binary got such error, help me please!

## What was done

Traced the crash to `src/components/StructuredDiff/colorDiff.ts` importing `ColorDiff` from the `color-diff-napi` package, which was aliased in `package.json` to `stubs/color-diff-napi/index.js`. That stub had placeholder methods (`diff()`, `getColors()`) instead of the `render()` method the calling code expected.

A full working TypeScript implementation already existed at `src/native-ts/color-diff/index.ts` with the correct `render(themeName, width, dim): string[] | null` signature, but was never wired up to the consumer.

First attempt used a re-export in the stub pointing at the TS port via a relative path — this broke because pnpm installs the stub under a virtualstore path (`node_modules/.pnpm/color-diff-napi@file+stubs+color-diff-napi/...`), making the relative path unreachable at build time.

Final fix: changed the single import in `colorDiff.ts` from `'color-diff-napi'` to `'../../native-ts/color-diff/index.js'`, bypassing the stub entirely.
