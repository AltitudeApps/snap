# Snap — TypeScript attendee scaffold

Implement the contract in the packaged `SPEC.md`; the language-neutral public
tests are the acceptance criteria. Use strict TypeScript, avoid `any`, and use
`node:` prefixes for Node built-ins.

## Setup, build, run, and test

```bash
npm ci
npm run build                    # type-check
npm start -- <arguments>         # run the CLI
./snap <arguments>               # executable used by the public harness
```

Run the packaged language-neutral verifier from the repository root:

```bash
./verify --lang ts
```

The unit and property tests SPEC.md §11 requires beyond the shared harness
live beside the source as `*.test.ts`:

```bash
npm test
```

Production code should use Node built-ins; `tsx`, TypeScript, and Node typings
are development dependencies.
