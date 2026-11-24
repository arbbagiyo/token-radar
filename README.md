[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, works
out which ones still record no token, ranks them by what their launch would be worth, and shows
a reader how to farm each one.

Built for the [make.fun bounty](https://make.fun/bounty/token-radar-01).

## The model (radar-3)

`main.ts` (Node 22, standard library only, no network) reads the snapshot, scores every
rankable pre-token protocol, and writes the ranked board to `board.json`, the dashboard's data
to `data.js`, and `dossier.json` via the vendored make.fun library.

Implied value is one function of the snapshot's own figures, the same for every row:

```
implied = round(tvl_usd x comp x growth x maturity x breadth)
comp     = clamp(sizeBase(tvl_usd) x catFactor(category), [0.01, 1.2])
sizeBase = 10 ^ (a + b x log10(tvl_usd))   — least squares on the live set's log ratios
growth   = 1 + 0.30 x tanh(clamp(change_7d, -90, 900) / 100), x 0.97 if unreported
maturity = 0.65 + min(age_days, 1095) / 1095 x 0.35, x 0.90 if listed under 90 days ago
breadth  = 1 + 0.02 per extra chain, at most 1.08
```

- **sizeBase** — the least-squares line through the live protocols' log10(market-cap/TVL)
  on log10(TVL), after winsorising each live ratio to [0.005, 5]. On this snapshot the fit
  is about log10 ratio = 2.52 − 0.42 × log10 TVL: a $10M protocol's base is ~0.41, a $1B
  protocol's ~0.06. radar-2's flat category median scored $2.7B protocols at small-cap
  multiples; radar-3 does not.
- **catFactor** — the category's median residual from that line, shrunk toward 1 with a
  prior weight of 6 and clamped to [0.25, 2.5]. A one-member category keeps only a seventh
  of its residual, so a single odd live protocol cannot set its whole category's multiple.
- **growth** — a tanh factor bounded to [0.70, 1.30]; an unreported 7-day change is
  discounted by 0.97, never treated as a flat week.
- **maturity** — how long the protocol has run with no token (days since first listed;
  unlisted ages score 365 days), from 0.65 to 1.00 over three years, with a 0.90 haircut
  for listings under 90 days old.
- **breadth** — 1 + 0.02 per extra chain, at most 1.08.
- **Backtest** — scored as if they had no token, the 128 live protocols come out a
  median 3.2x from their real market caps, with 63 of 128 inside 3x (radar-2's comp
  alone: 3.9x, 53 of 128). In-sample by construction; the dashboard says so.

The board covers all 40 watchlist slugs plus 158 further pre-token protocols below the
$50M floor — 198 rows. Bridges, liquid staking, restaking and exchange products are left
out of the ranking: any token they issue belongs to a parent protocol, not to the product.
Protocols whose token already trades are kept apart in the Live view with their market caps.

## The dashboard

`dashboard/` is a static page (no network, no framework) on a bright paper palette: a
spotlight of the five strongest rows, a sortable, filterable board (search, category,
chain, minimum TVL, watchlist-only, pre-token / live tabs), a detail drawer for each
protocol with the model's factor breakdown, a "why this rank" list and its farm plan, and
a model panel stating the formula, the category factors and the backtest. Each farm plan
is seven concrete steps with what they cost and how long they take, derived from the
protocol's own category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Two runs write the same bytes. The dashboard in `out/` is served from any static server;
`screenshots/` holds the board, a detail view and a filtered view.

## License

MIT. See [LICENSE](LICENSE).
