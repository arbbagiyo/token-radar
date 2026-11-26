# Token Radar — radar-6

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/reward.svg)](https://make.fun/c/token-radar-01)

Pre-token protocols ranked by implied value — every value term fitted and
tested held-out on the 92 stand-alone traded comps, forward token odds from
a Weibull time-to-record model on the dated peers' own record, printed
ranges with measured honesty, a full 758-protocol ledger, and a costed farm
verdict on every row.

## What it is

A DefiLlama snapshot (758 protocols, as of 2026-11-14) goes in; a ranked
board of 198 pre-token protocols comes out (the 40 watchlist protocols, 138
early ones below the $50M floor, and 20 off-list ones at or above the floor
the house list leaves out). The value model is a size curve —
log10(market-cap/TVL) on log10(TVL), fitted on the 92 stand-alone protocols
that already trade (a cap that belongs to a parent or a venue is not
evidence about a new launch) — because the held-out tests refused every
extra term: the category effect, 7-day growth, age, chain count and
curvature were all tried and none of them lowered the held-out miss in both
tests, so the board prices on the size curve alone and says so, with the
full term table on the page. The token odds come from a separate Weibull
time-to-record model on the 645 dated protocols: the chance a protocol has
recorded a token by age t is F(t) = 1 − exp(−(t/λ)^k), and the odds printed
for a still-tokenless protocol are the forward odds of recording within 24
months, (F(age+2) − F(age)) / (1 − F(age)) — which fall the longer a
protocol has run with no token. Implied value = launch value × forward
odds. Every implied value carries a P25–P75 range (and P10–P90) taken from
the held-out residuals, with the measured coverage printed beside the
stated coverage, and a rank range from pricing the row at its own P25 and
P75 values.

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

Each row is costed, not sloganned, at a stated scenario: a $5,000 ticket,
an expected drop of 7% of the implied value shared in proportion to the
ticket's share of TVL, gas, a capital charge net of the yield the position
earns, and 2.5 hours of work over an 84-day hold. FARM when the net per
hour clears $25, THIN when the net is positive but below that, SKIP when
it is negative. The formula, the thresholds and the assumptions are
printed on the page, and the ticket and drop share are adjustable there.

## Honesty notes

- Implied value is the entry's own claim, never a price, and never a
  prediction that a token launches. Say a protocol records no token, never
  that it has none.
- The value model's held-out miss is ×2.99 leave-one-out, ×2.51
  walk-forward and ×3.23 five-fold by size; the flat median is ×4.51 /
  ×4.69. The odds model's Brier score is 0.223 ten-fold and 0.229
  walk-forward against a base rate of 0.250 / 0.314. The printed P25–P75
  range held 50% of real caps leave-one-out and 54% walk-forward (stated
  50%); P10–P90 held 78% / 71% (stated 80%). Those are the real numbers
  from this snapshot, whatever they are.
