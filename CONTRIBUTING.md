# Contributing

Thank you for helping. Issues and pull requests are welcome.

## Get it running

You need Node 24 or later and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm --filter @sheetcn/playground dev   # the playground, at http://localhost:5173
```

## Land a change

1. Open an issue first for anything larger than a small fix, so the approach can be agreed before you build it.
2. Keep each pull request to one change, with tests for new behaviour.
3. Before you push, run the same checks as CI:

   ```sh
   pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:licenses && pnpm test:e2e
   ```

   The timing gates that shared runners time too unevenly (`pnpm test:perf`: the first sort by text, a commit with a view on, and the browser view gates) run in the performance job on main and nightly, not on pull requests; run them yourself if you change filtering, sorting or commits.

4. Write plain English, and use a plain dash rather than an em dash (`pnpm lint` checks this).
5. For changes that touch commit speed, measure on the playground's production build and put the numbers in the pull request. The README explains how.

By contributing, you agree that your work is released under the [MIT license](LICENSE).
