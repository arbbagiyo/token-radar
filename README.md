[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arbbagiyo/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — radar-4

A token launch radar: it reads a sealed DefiLlama snapshot, ranks every pre-token
protocol by an implied launch value, and shows each protocol's farm plan on a dark
console dashboard.

The model is calibrated from the snapshot's own live protocols on every run: a
least-squares size curve of log10(market-cap/TVL) on log10(TVL), shrunk category
factors, a tanh-bounded growth factor, a maturity factor with a young-listing
haircut, a breadth factor for multi-chain protocols, and a level correction that
centres the backtest's median bias at zero (computed from the live set, never
hardcoded). The backtest scores the live protocols as if they had no token and
compares with their real market caps — in-sample, and labelled as such on the
dashboard. Live-token protocols are shown separately with their market caps,
never mixed into the ranking.

## Run it

```sh
mkdir -p /tmp/radar4-out
MAKEFUN_OUTPUT_DIR=/tmp/radar4-out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only, no network. The program writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output
directory, and runs twice with byte-identical outputs.

## Links

- Bounty: https://make.fun/bounty/token-radar-01
- make.fun: https://make.fun/?ref=zaqk8shq
