# tvf-core

The Token Verification Framework (`tvf`): a standard, versioned set of yes/no token-safety
questions that [IMD](https://imd.fun) consensus panels answer as signed EIP-712 attestations.
It covers a token and its main Uniswap pool on Ethereum mainnet (`1`) and Robinhood Chain (`4663`).

This repository is public so IMD reviewers can read every framework version and proposal by
commit URL and diff hash.

| Path | What |
|---|---|
| [`schema/tvf-1.schema.json`](schema/tvf-1.schema.json) | JSON Schema for a framework document |
| [`frameworks/core/1.0.0.json`](frameworks/core/1.0.0.json) | `core@1.0.0`: 30 bool checks, thresholds, scoring and the immutable review config |
| [`proposals/`](proposals/README.md) | How changes to `core` are proposed and decided |
| [`schema/proposal-1.schema.json`](schema/proposal-1.schema.json) | JSON Schema for a proposal |
| `src/` | Canonical hashing, validator, bundle compiler and the `tvf` CLI |
| [`probes/m0/results.json`](probes/m0/results.json) | The free M0 quote probe against `api.imd.fun` |

## Framework

Every check is one bool proposition (`fact`) about `{token}`, `{pool}` and `{chain}`. Numeric facts
are thresholds with bounded `params` (`bps`, `days`, `usd`, `count`), and `riskIf` names the risky
answer. Definitions pin the reading. A definition key used by several checks has the same text in
all of them, so a bundle carries it once.

Versions are immutable and content-addressed. The version bump follows semver:

- patch: wording or definitions;
- minor: add a check or change a default threshold;
- major: remove a check, or change `scoring` or `review`.

`review` and `scoring` must be identical across all versions with the same major, and `tvf validate`
enforces that when given several versions.

## Hashing

`hash` is `keccak256` of the document's canonical JSON with the `hash` field removed, written as
`0x` plus 64 lowercase hex characters. Canonical JSON has object keys sorted by UTF-16 code unit,
no whitespace, strings escaped as `JSON.stringify` does, and only safe integers as numbers (floats
are rejected). It matches the canonical encoder in IMD's payment docs.

`core@1.0.0` = `0xee0f45612ab4ecdbee689b7a0f5a5e19e7d89505bceb30b58cc24854aa925edd`

## Bundles

A bundle is one IMD `oracle.request` with `answerType: "bytes32"` and `evidence: "panel"`. Bit `i`
of the answer is fact `i`. The question names only the bit layout. Each fact's text is in
`definitions.f<i>`, the layout is in `definitions.bits`, and shared definitions appear once per bundle.
`guards.sources` is the union of the checks' sources.

The compiler packs subjects × checks in order into bundles of at most `k` facts (default 6, max
16) that share a window. It enforces IMD's limits: question ≤ 2,000 characters, ≤ 64 definitions of
≤ 512 characters each, ≤ 32 sources, and a quote body ≤ 16 KiB. Profiles set the panel: `fast`
7/5, `standard` 15/11 (the default), `strict` 25/20.

## CLI

Requires Node 22 and pnpm.

```bash
pnpm install && pnpm build

node dist/cli.js validate frameworks/core/*.json proposals/*/proposal.json
node dist/cli.js hash frameworks/core/1.0.0.json            # add --write to update the file
node dist/cli.js compile frameworks/core/1.0.0.json --chain 1 \
  --token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --token 0x0e14Fb97222b06B0B4feFA224cc106A711dD4E1D@v2:0x0000000000000000000000000000000000000001 \
  --k 6 --profile standard --param trading.sell_tax_gt:bps=500
```

`compile` prints the plan: the framework `id`, `version` and `hash`, the resolved params, and each
bundle's `input` (the `oracle.request` body) with its bit map `{bit, token, checkId}`. A pool is
`@v2:<address>`, `@v3:<address>` or `@v4:<poolId>`. Without one, the facts use the token's
highest-TVL Uniswap pool against WETH, USDC or USDT.

## M0 probe

```bash
pnpm build && pnpm m0:quotes
```

This compiles the 6-fact `core` bundles for USDC and BIO (a honeypot), then sends each to IMD's
free `POST /requests/check` and as an unpaid `POST /requests/quote` (random bearer token, no wallet,
≤ 25 calls a minute). It does this twice: once with fact wording in `definitions`, and once with
fact wording inline in `question`. It never submits or signs anything, and the quotes expire unpaid.
The gate passes when every definitions-wording quote is created with no `problems`. Results are
written to `probes/m0/results.json`.

The committed run (2026-10-11) passed. All 20 quotes (both wordings) were created as `quoted`
with no `problems`. `/requests/check` doesn't accept `definitions`, so it sees only the bit-layout
question and blocks it as `not_answerable`. That's why bundles are validated with the full-body
quote, not with check. The inline wording passed check with no blockers, only advisory `wording`,
`evidence` and `not_answerable` suggestions, so it remains the fallback.

## License

[MIT](LICENSE)
