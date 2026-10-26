# Third-party notices

sheetcn is released under the MIT License (see [LICENSE](LICENSE)).

This file lists third-party code that ships to users in the published packages, with its license and copyright notice.

## Shipped code

None. `@sheetcn/core` and `@sheetcn/react` have no third-party runtime dependencies and contain no code copied from other projects.

When a runtime dependency is added, or code is copied from another project, add an entry here with:

- the project name, its source URL and the version or commit,
- the files or functions it covers,
- its copyright line and the full license text.

`pnpm check:licenses` (`scripts/check-licenses.mjs`, run in CI) fails when a shipped package is missing from this file.

## Development tools

TypeScript, ESLint, Prettier, Vitest, fast-check and their dependencies build and test sheetcn and are not shipped. The same scan checks that each of them carries an allowed license.
