# Proposals

Changes to `core` are proposed here and decided by an IMD panel, not by a maintainer. A proposal
merges if and only if its review request (the `review` block of the base version) attests `true`
with `agreed >= quorum`. See SPEC §8.

## Format

A proposal is one pull request containing:

| Path | Content |
|---|---|
| `proposals/<id>/proposal.json` | Metadata, validated by [`schema/proposal-1.schema.json`](../schema/proposal-1.schema.json). Copy [`_template/proposal.json`](_template/proposal.json). |
| `frameworks/core/<next>.json` | The new framework version, with its `hash` written by `tvf hash --write`. |

`<id>` is a four-digit sequence number and a slug, e.g. `0001-sell-tax-wording`. Directories
starting with `_` are not proposals.

Proposal CI (M4) adds the canonical diff file and its keccak256 `diffHash`, and the backtest
report at `backtests/<id>/report.json`. Both are public before the review request is asked.

## Rules

A proposal is refused before it is asked if any of these fail:

- `tvf validate` passes for `proposal.json` and the new framework version, and every check stays bool.
- The semver bump is correct: patch for wording or definitions; minor to add a check or change a
  default threshold; major to remove a check or change scoring.
- At most 5 checks are touched, and `checks` lists exactly those ids.
- `review` and `scoring` are unchanged. Only Eric cuts a major version that changes them.
- Only one proposal is open at a time.
- 7-day cooldown after any decision.
- A rejected change to the same check ids can't be re-proposed for 30 days.
- The proposer and the merge bot are separate identities.
- Schema and backtest CI pass.

## Review request

Built exactly from the base version's `review` block, with `{proposalId}`, `{diffHash}`, `{base}`,
`{next}`, `{diffUrl}` and `{reportUrl}` filled in. Panel 100, quorum 85, 72-hour window, valid for
604,800 s, `allowAmbiguous` never set. If the quote returns `quorum_unreachable`, the proposal
waits; the quorum is never lowered.
