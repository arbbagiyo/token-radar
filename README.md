[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, works
out which ones still record no token, ranks them by what their launch would be worth, and shows
a reader how to farm each one.

Built for the [make.fun bounty](https://make.fun/bounty/token-radar-01).

## The model (radar-2)

`main.ts` (Node 22, standard library only, no network) reads the snapshot, scores every
rankable pre-token protocol, and writes the ranked board to `board.json`, the dashboard's data
to `data.js`, and `dossier.json` via the vendored make.fun library.

Implied value is one function of the snapshot's own figures, the same for every row:

```
implied = round(tvl_usd x comp(category) x (1 + 0.30 x tanh(clamp(change_7d, -90, 900) / 100))
                x (0.70 + min(age_days, 1095) / 1095 x 0.30))
```

- **comp(category)** — the median market-cap-to-TVL ratio of the live protocols in that
  category, shrunk toward the global median (prior weight 8) and clamped to [0.05, 1.5]. A
  category with no live member uses the global median. A live member whose recorded market
  cap is $0 carries no ratio: a zero is a gap in the record, not a price.
- **growth** — a tanh factor bounded to [0.70, 1.30], so a weekly spike cannot multiply the
  value the way a linear clamp would let it.
- **maturity** — how long the protocol has run with no token (days since first listed;
  unlisted ages score 365 days), linear over three years from 0.70 to 1.00.

The board covers all 40 watchlist slugs plus 158 further pre-token protocols below the
$50M floor — 198 rows. Bridges, liquid staking, restaking and exchange products are left
out of the ranking: any token they issue belongs to a parent protocol, not to the product.
Protocols whose token already trades are kept apart in the Live view with their market caps.

## The dashboard

`dashboard/` is a static page (no network, no framework): a sortable, filterable board
(search, category, chain, pre-token / live tabs), a detail drawer for each protocol with the
model's factor breakdown and its farm plan, and a model panel stating the formula and the
category multiples. Each farm plan is six concrete steps with what they cost and how long
they take, derived from the protocol's own category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Two runs write the same bytes. The dashboard in `out/` is served from any static server;
`screenshots/` holds the board, a detail view and a filtered view.

## License

MIT. See [LICENSE](LICENSE).
