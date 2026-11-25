# Token Radar — radar-5

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/reward.svg)](https://make.fun/c/token-radar-01)

Pre-token protocols ranked by implied value — every value term fitted and
tested held-out twice (leave-one-out and walk-forward), token odds fitted
from the dated peers' own record, printed ranges with measured honesty, a
full 758-protocol ledger, and a costed farm verdict on every row.

## What it is

A DefiLlama snapshot (758 protocols, as of 2026-11-14) goes in; a ranked
board of 198 pre-token protocols comes out. The value model is a size curve
— log10(market-cap/TVL) on log10(TVL), fitted on the 128 protocols that
already trade — because the held-out tests refused every extra term: the
category effect, 7-day growth, age, chain count and breadth were all tried
and none of them lowered the held-out miss in both tests, so the board
prices on the size curve alone and says so, with the full term table on the
page. The token odds come from a separate logistic model on the 645 dated
protocols (age, size, growth), validated by Brier score ten-fold and
walk-forward against the base rate. Implied value = launch value x token
odds. Every implied value carries a P25–P75 range (and P10–P90) taken from
the held-out residuals, with the measured coverage printed beside the
stated coverage.

## Run it

Node 22, standard library only, no network:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

That writes `out/board.json` (198 rows), `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Two runs on the same snapshot
write byte-identical output. The dashboard is a static page: serve `out/`
over HTTP (or open `out/dashboard/index.html` with `data.js` beside it)
and it renders from `data.js` with no network.

## Farm verdicts

Each row is costed, not sloganned: a deposit sized from the protocol's TVL,
an expected drop (a stated share of the implied value, adjustable on the
page), gas, a capital charge on the deposit, and six hours of work at
$15/hour. FARM when the net per hour clears $20, MARGINAL when the net is
positive but below that, SKIP when it is negative. The formula, the
thresholds and the assumptions are printed on the page.

## Honesty notes

- Implied value is the entry's own claim, never a price, and never a
  prediction that a token launches. Say a protocol records no token, never
  that it has none.
- The value model's held-out miss is x3.46 leave-one-out and x2.89
  walk-forward; the flat median is x5.07 / x5.25. The odds model's Brier
  score is 0.120 ten-fold and 0.071 walk-forward against a base rate of
  0.126 / 0.085. Those are the real numbers from this snapshot, whatever
  they are.
