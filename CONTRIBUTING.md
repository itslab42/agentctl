# Contributing to agentctl

Thanks for your interest in contributing! Here's how to get started.

## Development setup

```bash
git clone https://github.com/itslab42/agentctl.git
cd agentctl
pnpm install
```

## Scripts

```bash
pnpm check          # format + lint + typecheck + test (all-in-one)
pnpm build          # compile, copy stubs, minify
pnpm test           # run tests
pnpm format         # auto-format with oxfmt
pnpm lint:fix       # auto-fix lint issues
```

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm check` to ensure everything passes
4. Commit with a clear message describing what changed
5. Open a pull request against `main`

## Pull requests

- Keep PRs focused — one feature or fix per PR
- CI must pass (format, lint, typecheck, test)
- One approval is required to merge

## Adding a new adapter

1. Create `src/adapters/<name>.ts` with a render function
2. Wire it into `src/cli.ts` (follow the existing pattern)
3. Add tests in `tests/<name>.test.ts`
4. Update the README with the new supported agent

## Code style

- TypeScript strict mode
- Formatting enforced by [oxfmt](https://github.com/nicolo-ribaudo/oxfmt)
- Linting enforced by [oxlint](https://github.com/nicolo-ribaudo/oxlint)
- No runtime dependencies beyond `yaml`

## Reporting issues

Use the [issue templates](https://github.com/itslab42/agentctl/issues/new/choose) — bug reports, feature requests, and adapter requests are all welcome.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
