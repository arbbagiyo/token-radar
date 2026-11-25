// Token Radar, radar-5 — the scoring model.
//
// A sealed DefiLlama snapshot goes in; a ranked board of pre-token protocols
// comes out. The ranking is a pure function of the snapshot: nothing is
// fetched, nothing is special-cased by name, and two runs on the same input
// write the same bytes.
//
// The pipeline is an experiment, not a curve-fitting exercise. Every number
// the dashboard prints comes from one of these six stages, each a separate
// function so the page can quote it by name:
//
//   1. fit — the size curve. Least squares on log10(market-cap/TVL) against
//      log10(TVL) over the live protocols (ratios winsorised to [0.005, 5]).
//      Large protocols trade at smaller multiples than small ones, so the
//      curve — never a flat median — sets the base multiple for a protocol
//      of a given size.
//   2. leaveOneOut — every candidate term is scored by leaving each live
//      protocol out in turn, refitting on the rest, and pricing the held-out
//      one. The miss is the median factor error (median of |log10(pred/real)|
//      turned back into a multiple).
//   3. walkForward — the same terms, but time-split: the earliest ~57 dated
//      live protocols price the latest ~38. A term that only works in-sample
//      dies here.
//   4. selectTerms — a term is KEPT only if adding it to the kept set lowers
//      BOTH held-out misses by at least 1% (leave-one-out AND walk-forward).
//      The rest are reported as tested, not kept, beside a placebo control
//      (a constant feature that must not help). On this snapshot the size
//      curve stands alone: category, growth, age, chain count, breadth and
//      the log-TVL-squared curvature term all fail the rule, so the board
//      prices on the curve alone and the dashboard shows the table that
//      proves it.
//   5. fitOdds — a separate logistic model on the 645 dated protocols
//      (token recorded vs not) from age, size and growth, validated by Brier
//      score ten-fold and walk-forward against the base rate. Before the
//      fit, the peer set itself is tested: the same model on the
//      stand-alone subset (derivative categories, versioned or wrapped /
//      staked names and exchange-named products excluded, the same rule
//      the board applies) is adopted only when it beats the full set on
//      BOTH Brier scores; on this snapshot it does not, so the full set
//      is kept and the comparison is recorded in the evidence. Implied value
//      = launch value x token odds. The odds are the peers' record — the
//      share of dated peers that recorded a token — not a forecast that any
//      one protocol launches.
//   6. ranges — P25-P75 and P10-P90 from the leave-one-out residuals of the
//      final model, with the measured coverage (what share of real caps fell
//      inside the printed range, held-out) printed next to the stated one.
//      bootstrap — 200 refits of the size curve on resampled live sets give
//      the standard error of each coefficient, printed beside it.
//   7. farmVerdict — every row is costed: a deposit sized from its TVL, an
//      expected drop (a stated share of the implied value), gas, a capital
//      charge on the deposit, and six hours of work at $15 an hour. FARM /
//      MARGINAL / SKIP follow from the net per hour against a stated bar.
//
// The board ranks 198 rows: the 40 watchlist protocols plus every other
// pre-token protocol the board can honestly score, whatever its TVL. The
// ledger accounts for all 758 snapshot protocols in exactly one group.

/** One protocol row of the sealed snapshot: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  winsor_low: number;
  winsor_high: number;
  keep_threshold_pct: number;
  walk_forward_train: number;
  cat_prior: number;
  cat_min_members: number;
  growth_floor: number;
  growth_cap: number;
  odds_horizon_months: number;
  odds_folds: number;
  bootstrap_refits: number;
  range_low: number;
  range_high: number;
  range_outer_low: number;
  range_outer_high: number;
  deposit_tiers: { atLeast: number; deposit: number }[];
  drop_share_pct: number;
  farmer_rate: number;
  gas_usd: number;
  gas_pct: number;
  capital_rate_pct: number;
  work_hours: number;
  hourly_usd: number;
  farm_bar_per_hour: number;
}

export const MODEL: ModelConstants = {
  winsor_low: 0.005,
  winsor_high: 5,
  keep_threshold_pct: 1,
  walk_forward_train: 57,
  cat_prior: 6,
  cat_min_members: 5,
  growth_floor: -90,
  growth_cap: 900,
  odds_horizon_months: 24,
  odds_folds: 10,
  bootstrap_refits: 200,
  range_low: 0.25,
  range_high: 0.75,
  range_outer_low: 0.1,
  range_outer_high: 0.9,
  deposit_tiers: [
    { atLeast: 5_000_000_000, deposit: 250 },
    { atLeast: 1_000_000_000, deposit: 150 },
    { atLeast: 100_000_000, deposit: 100 },
  ],
  drop_share_pct: 5,
  farmer_rate: 0.0005,
  gas_usd: 28,
  gas_pct: 0.003,
  capital_rate_pct: 6,
  work_hours: 6,
  hourly_usd: 15,
  farm_bar_per_hour: 20,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** The least-squares line for log10(market-cap/TVL) on log10(TVL), fit on the live set. */
export interface SizeFit {
  members: number;
  intercept: number;
  slope: number;
}

/** One candidate value term and what the two held-out tests said about it. */
export interface TermResult {
  term: string;
  label: string;
  loo_miss: number;
  walk_forward_miss: number;
  kept: boolean;
  control: boolean;
}

/** The value model's held-out evidence, as the dashboard prints it. */
export interface ValueEvidence {
  members: number;
  dated_members: number;
  walk_forward_train: number;
  walk_forward_test: number;
  flat_loo_miss: number;
  flat_walk_forward_miss: number;
  base_loo_miss: number;
  base_walk_forward_miss: number;
  base_within_3x_loo: number;
  base_within_3x_walk_forward: number;
  level_factor: number;
  level_applied: boolean;
  level_loo_before: number;
  level_loo_after: number;
  level_median_signed_log_error: number;
  terms: TermResult[];
  kept_terms: string[];
  coefficients: { name: string; value: number; se: number }[];
  range_p25: number;
  range_p75: number;
  range_p10: number;
  range_p90: number;
  coverage_p25_p75_loo: number;
  coverage_p10_p90_loo: number;
  coverage_p25_p75_walk_forward: number;
  coverage_p10_p90_walk_forward: number;
}

/** One candidate odds term and what the two Brier tests said about it. */
export interface OddsTermResult {
  term: string;
  label: string;
  brier_ten_fold: number;
  brier_walk_forward: number;
  kept: boolean;
}

/** The odds peer-set test: the full dated set against the stand-alone subset. */
export interface OddsPeerSetTest {
  adopted: 'full' | 'stand-alone';
  full_peers: number;
  full_token_peers: number;
  full_brier_ten_fold: number;
  full_brier_walk_forward: number;
  restricted_peers: number;
  restricted_token_peers: number;
  restricted_brier_ten_fold: number;
  restricted_brier_walk_forward: number;
  note: string;
}

/** The odds model's held-out evidence, as the dashboard prints it. */
export interface OddsEvidence {
  peers: number;
  token_peers: number;
  base_rate: number;
  base_brier_ten_fold: number;
  base_brier_walk_forward: number;
  brier_ten_fold: number;
  brier_walk_forward: number;
  walk_forward_train: number;
  walk_forward_test: number;
  peer_set: 'full' | 'stand-alone';
  peer_set_note: string;
  peer_set_test: OddsPeerSetTest;
  called_right_ten_fold_pct: number;
  age_bands: { band: string; peers: number; token_rate: number }[];
  terms: OddsTermResult[];
  kept_terms: string[];
  coefficients: { name: string; value: number }[];
  odds_median: number;
  odds_p75: number;
  odds_max: number;
}

/** One group of the 758-protocol ledger. */
export interface LedgerGroup {
  key: string;
  label: string;
  count: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  age_days: number | null;
  token_status: 'pre-token';
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  model: {
    launch_value_usd: number;
    token_odds: number;
    odds_age_known: boolean;
    size_base: number;
    cat_factor: number | null;
    comp_members: number;
    level_factor: number;
    range_p25_usd: number;
    range_p75_usd: number;
    range_p10_usd: number;
    range_p90_usd: number;
    age_days: number | null;
    growth_pct: number | null;
  };
  farm: {
    deposit_usd: number;
    hold_days: number;
    expected_drop_usd: number;
    fees_usd: number;
    capital_charge_usd: number;
    hours: number;
    net_usd: number;
    net_per_hour_usd: number;
    verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan and economics included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  launch_value_usd: number;
  token_odds: number;
  odds_age_known: boolean;
  size_base: number;
  cat_factor: number | null;
  comp_members: number;
  level_factor: number;
  range_p25_usd: number;
  range_p75_usd: number;
  range_p10_usd: number;
  range_p90_usd: number;
  deposit_usd: number;
  hold_days: number;
  expected_drop_usd: number;
  fees_usd: number;
  capital_charge_usd: number;
  hours: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number | null;
  category: string | null;
  chains: string[];
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the evidence, the ledger, the live set. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  checksum: string;
  size_fit: SizeFit;
  value: ValueEvidence;
  odds: OddsEvidence;
  ledger: LedgerGroup[];
  verdict_counts: { FARM: number; MARGINAL: number; SKIP: number };
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Round to four decimals: the dashboard prints factors at this precision. */
function round4dp(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Round to two decimals: money and odds print at this precision. */
function round2dp(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Clamp into [low, high]. */
function clampValue(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** The median of a set of numbers, or 0 when it is empty. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

/** The p-th quantile (0-1) of a set of numbers, linearly interpolated. */
function quantileOf(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const at = (ordered.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return ordered[lo]!;
  return ordered[lo]! + (ordered[hi]! - ordered[lo]!) * (at - lo);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((start - listed) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token: any of mcap, gecko id or symbol present. */
export function hasTokenRecord(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in the name: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories whose token, if any, belongs to a parent protocol, never to the product itself. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol is one the board may rank: pre-token and a launch of its own. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === null) return false;
  if (DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  return !WRAPPED_WORD.test(p.name);
}

/** Exchange names: a product named for a venue is the venue's own token, never a stand-alone launch. */
const EXCHANGE_NAME_PREFIXES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a dated peer is a stand-alone protocol: the same exclusion the
 * board rule applies — a derivative category, a versioned name, a wrapped /
 * staked / staking name — plus exchange-named products. Bridges, liquid
 * staking, restaking and exchange products record tokens that belong to a
 * parent or a venue, so they are not launches of their own and do not
 * belong in the peer set the odds model learns the launch rate from.
 */
export function isStandAlonePeer(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return !EXCHANGE_NAME_PREFIXES.test(p.name);
}

/** A live protocol's market-cap-to-TVL ratio, winsorised: an extreme ratio is a data gap, not a price. */
function liveRatio(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return clampValue(p.mcap_usd / p.tvl_usd, model.winsor_low, model.winsor_high);
}

/** Plain least squares through a set of points: slope, then intercept from the means. */
function leastSquares(points: { x: number; y: number }[]): { intercept: number; slope: number } {
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const pt of points) {
    sumX += pt.x;
    sumY += pt.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let cov = 0;
  let varX = 0;
  for (const pt of points) {
    const dx = pt.x - meanX;
    const dy = pt.y - meanY;
    cov += dx * dy;
    varX += dx * dx;
  }
  const slope = varX === 0 ? 0 : cov / varX;
  return { intercept: meanY - slope * meanX, slope };
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / d;
      for (let j = col; j <= n; j++) m[r]![j]! -= f * m[col]![j]!;
    }
  }
  return m.map((row, i) => row[n]! / (row[i]! || 1e-12));
}

/** Ordinary least squares for a design matrix (first column the intercept). */
function ols(design: number[][], y: number[]): number[] {
  const k = design[0]!.length;
  const a: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const b: number[] = Array(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    for (let x = 0; x < k; x++) {
      b[x] += design[i]![x]! * y[i]!;
      for (let c = 0; c < k; c++) a[x]![c]! += design[i]![x]! * design[i]![c]!;
    }
  }
  return solveLinear(a, b);
}

// ---------------------------------------------------------------- fit

/** The live protocols: they already trade, so their ratios calibrate the curve. */
function liveSet(snapshot: Snapshot, model: ModelConstants): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => liveRatio(p, model) !== null);
}

/** The size curve: least squares through the live protocols' log10 ratio on log10 TVL. */
export function fitSizeCurve(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): SizeFit {
  const pts: { x: number; y: number }[] = [];
  for (const p of protocols) {
    const r = liveRatio(p, model);
    if (r === null) continue;
    pts.push({ x: Math.log10(p.tvl_usd), y: Math.log10(r) });
  }
  const n = pts.length;
  if (n < 10) return { intercept: Math.log10(0.2), slope: 0, members: n };
  const line = leastSquares(pts);
  return { intercept: round4dp(line.intercept), slope: round4dp(line.slope), members: n };
}

/** The size curve's base multiple for one TVL: what a protocol of that size typically trades at. */
export function sizeBaseFor(tvlUsd: number, fit: SizeFit): number {
  if (tvlUsd <= 0 || Number.isNaN(tvlUsd)) return 0.2;
  return Math.pow(10, fit.intercept + fit.slope * Math.log10(tvlUsd));
}

// ---------------------------------------------------------------- candidate terms

/** A candidate value term: its feature for one protocol, given the training set's category map. */
export interface TermSpec {
  key: string;
  label: string;
  control: boolean;
  feature: (p: SnapshotProtocol, asOf: string, cat: Map<string, number>) => number;
}

/**
 * The category map of a training set: each category's median residual from
 * the size curve, shrunk toward 0 with a prior weight, and only for
 * categories with at least `cat_min_members` live members — a one-member
 * category's residual is noise, not a price.
 */
function categoryMap(train: SnapshotProtocol[], fit: SizeFit, model: ModelConstants): Map<string, number> {
  const residuals = new Map<string, number[]>();
  for (const p of train) {
    const r = liveRatio(p, model);
    if (r === null || p.category === null) continue;
    const list = residuals.get(p.category) ?? [];
    list.push(Math.log10(r) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd)));
    residuals.set(p.category, list);
  }
  const out = new Map<string, number>();
  for (const [category, rs] of residuals) {
    if (rs.length < model.cat_min_members) {
      out.set(category, 0);
      continue;
    }
    const med = medianOf(rs);
    out.set(category, (rs.length * med) / (rs.length + model.cat_prior));
  }
  return out;
}

/** The seven candidate terms, in the order they are tested. */
export function termSpecs(model: ModelConstants = MODEL): TermSpec[] {
  return [
    {
      key: 'cat',
      label: 'category effect, ridge ' + model.cat_prior,
      control: false,
      feature: (p, _asOf, cat) => (p.category === null ? 0 : cat.get(p.category) ?? 0),
    },
    {
      key: 'growth',
      label: '7-day TVL growth',
      control: false,
      feature: (p) =>
        p.change_7d === null || !Number.isFinite(p.change_7d)
          ? 0
          : Math.tanh(clampValue(p.change_7d, model.growth_floor, model.growth_cap) / 100),
    },
    {
      key: 'age',
      label: 'age, years listed',
      control: false,
      feature: (p, asOf) => (ageDays(asOf, p.listed_at) ?? 365) / 365,
    },
    {
      key: 'logCh',
      label: 'chain count, log',
      control: false,
      feature: (p) => Math.log10(Math.max(1, p.chains.length)),
    },
    {
      key: 'breadth',
      label: 'breadth, chains capped at 5',
      control: false,
      feature: (p) => Math.min(p.chains.length, 5) / 5,
    },
    {
      key: 'logTvl2',
      label: 'log-TVL squared, curvature',
      control: false,
      feature: (p) => {
        const x = Math.log10(p.tvl_usd);
        return x * x;
      },
    },
    {
      key: 'placebo',
      label: 'control: growth of another row',
      control: true,
      feature: () => 0.37,
    },
  ];
}

/** One design row: intercept, log10 TVL, then one column per term in `keys`. */
function designRow(
  p: SnapshotProtocol,
  asOf: string,
  cat: Map<string, number>,
  keys: string[],
  specs: TermSpec[],
): number[] {
  const row: number[] = [1, Math.log10(p.tvl_usd)];
  for (const key of keys) {
    const spec = specs.find((s) => s.key === key)!;
    row.push(spec.feature(p, asOf, cat));
  }
  return row;
}

/** A fitted value model: its coefficients, over the kept terms. */
interface FittedValue {
  beta: number[];
  keys: string[];
  fit: SizeFit;
  cat: Map<string, number>;
}

/** Fit the value model on a training set: size curve, category map, then OLS on the kept terms. */
function fitValueModel(
  train: SnapshotProtocol[],
  asOf: string,
  keys: string[],
  specs: TermSpec[],
  model: ModelConstants,
): FittedValue {
  const fit = fitSizeCurve(train, model);
  const cat = categoryMap(train, fit, model);
  const design = train.map((p) => designRow(p, asOf, cat, keys, specs));
  const y = train.map((p) => Math.log10(liveRatio(p, model)!));
  const beta = ols(design, y);
  return { beta, keys, fit, cat };
}

/** Price one protocol with a fitted value model: its launch value before level and odds. */
function predictLaunch(p: SnapshotProtocol, asOf: string, fitted: FittedValue, specs: TermSpec[]): number {
  const row = designRow(p, asOf, fitted.cat, fitted.keys, specs);
  const logRatio = row.reduce((sum, v, j) => sum + v * fitted.beta[j]!, 0);
  return Math.max(1, p.tvl_usd * Math.pow(10, logRatio));
}

/** The median factor error of a set of predictions against real market caps. */
function medianFactorError(preds: number[], actuals: number[]): number {
  const errs = preds.map((pr, i) => Math.abs(Math.log10(pr / actuals[i]!)));
  return Math.pow(10, medianOf(errs));
}

/** How many predictions land within 3x of the real market cap. */
function within3x(preds: number[], actuals: number[]): number {
  let n = 0;
  preds.forEach((pr, i) => {
    const r = pr / actuals[i]!;
    if (r > 1 / 3 && r < 3) n++;
  });
  return n;
}

// ---------------------------------------------------------------- leave-one-out

/** Leave-one-out: refit on all but one live protocol, price the held-out one. */
export function leaveOneOut(
  live: SnapshotProtocol[],
  asOf: string,
  keys: string[],
  specs: TermSpec[],
  model: ModelConstants,
): { preds: number[]; actuals: number[]; miss: number; within3: number } {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const fitted = fitValueModel(train, asOf, keys, specs, model);
    preds.push(predictLaunch(live[i]!, asOf, fitted, specs));
    actuals.push(live[i]!.mcap_usd!);
  }
  return { preds, actuals, miss: medianFactorError(preds, actuals), within3: within3x(preds, actuals) };
}

/** The flat baseline: the median live ratio, no size curve at all. */
function flatMiss(
  live: SnapshotProtocol[],
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  model: ModelConstants,
): number {
  const ratios = train.map((p) => liveRatio(p, model)!);
  const med = medianOf(ratios);
  return medianFactorError(
    test.map((p) => p.tvl_usd * med),
    test.map((p) => p.mcap_usd!),
  );
}

// ---------------------------------------------------------------- walk-forward

/** Walk-forward: the earliest dated live protocols price the latest ones. */
export function walkForward(
  live: SnapshotProtocol[],
  asOf: string,
  keys: string[],
  specs: TermSpec[],
  model: ModelConstants,
): { preds: number[]; actuals: number[]; miss: number; within3: number; trainN: number; testN: number } {
  const dated = live
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const train = dated.slice(0, model.walk_forward_train);
  const test = dated.slice(model.walk_forward_train);
  const fitted = fitValueModel(train, asOf, keys, specs, model);
  const preds = test.map((p) => predictLaunch(p, asOf, fitted, specs));
  const actuals = test.map((p) => p.mcap_usd!);
  return { preds, actuals, miss: medianFactorError(preds, actuals), within3: within3x(preds, actuals), trainN: train.length, testN: test.length };
}

// ---------------------------------------------------------------- term selection

/**
 * Select the value terms. Each candidate is tried in addition order on top
 * of the terms already kept; it stays only when it lowers BOTH held-out
 * misses by at least `keep_threshold_pct`. The placebo is always tried last
 * and must not help. Returns the evidence table and the kept keys.
 */
export function selectValueTerms(
  live: SnapshotProtocol[],
  asOf: string,
  specs: TermSpec[],
  model: ModelConstants,
): { terms: TermResult[]; kept: string[]; base: { loo: number; wf: number }; flat: { loo: number; wf: number }; wfN: { train: number; test: number } } {
  const dated = live.filter((p) => p.listed_at !== null);
  const baseLoo = leaveOneOut(live, asOf, [], specs, model);
  const baseWf = walkForward(live, asOf, [], specs, model);
  const flatLoo = flatMiss(live, live, live, model);
  const flatWf = (() => {
    const d = [...dated].sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
    return flatMiss(live, d.slice(0, model.walk_forward_train), d.slice(model.walk_forward_train), model);
  })();
  const terms: TermResult[] = [];
  const kept: string[] = [];
  let curLoo = leaveOneOut(live, asOf, kept, specs, model);
  let curWf = walkForward(live, asOf, kept, specs, model);
  for (const spec of specs) {
    const trial = [...kept, spec.key];
    const loo = leaveOneOut(live, asOf, trial, specs, model);
    const wf = walkForward(live, asOf, trial, specs, model);
    const looGain = ((curLoo.miss - loo.miss) / curLoo.miss) * 100;
    const wfGain = ((curWf.miss - wf.miss) / curWf.miss) * 100;
    const keep = !spec.control && looGain >= model.keep_threshold_pct && wfGain >= model.keep_threshold_pct;
    if (keep) {
      kept.push(spec.key);
      curLoo = loo;
      curWf = wf;
    }
    terms.push({
      term: spec.key,
      label: spec.label,
      loo_miss: round4dp(loo.miss),
      walk_forward_miss: round4dp(wf.miss),
      kept: keep,
      control: spec.control,
    });
  }
  return {
    terms,
    kept,
    base: { loo: baseLoo.miss, wf: baseWf.miss },
    flat: { loo: flatLoo, wf: flatWf },
    wfN: { train: baseWf.trainN, test: baseWf.testN },
  };
}

// ---------------------------------------------------------------- level + ranges

/**
 * The level correction, decided held-out: the median signed log error of
 * the leave-one-out predictions. Applying 10^(-that median) centres the
 * bias; it is used only when it lowers the leave-one-out miss.
 */
export function levelFromHeldOut(
  loo: { preds: number[]; actuals: number[]; miss: number },
): { level: number; applied: boolean; before: number; after: number; medianSigned: number } {
  const signed = loo.preds.map((pr, i) => Math.log10(pr / loo.actuals[i]!));
  const med = medianOf(signed);
  const level = Math.pow(10, -med);
  const after = medianFactorError(
    loo.preds.map((pr) => pr * level),
    loo.actuals,
  );
  const applied = after < loo.miss;
  return { level: round4dp(applied ? level : 1), applied, before: round4dp(loo.miss), after: round4dp(after), medianSigned: round4dp(med) };
}

/** The printed ranges, from the leave-one-out residuals of the final model. */
export function rangesFromHeldOut(
  loo: { preds: number[]; actuals: number[] },
  wf: { preds: number[]; actuals: number[] },
  model: ModelConstants,
): {
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  cov2575Loo: number;
  cov1090Loo: number;
  cov2575Wf: number;
  cov1090Wf: number;
} {
  const residuals = loo.preds.map((pr, i) => Math.log10(loo.actuals[i]! / pr));
  const p25 = quantileOf(residuals, model.range_low);
  const p75 = quantileOf(residuals, model.range_high);
  const p10 = quantileOf(residuals, model.range_outer_low);
  const p90 = quantileOf(residuals, model.range_outer_high);
  const cover = (preds: number[], actuals: number[], lo: number, hi: number): number => {
    let n = 0;
    preds.forEach((pr, i) => {
      const r = Math.log10(actuals[i]! / pr);
      if (r >= lo && r <= hi) n++;
    });
    return preds.length === 0 ? 0 : round4dp(n / preds.length);
  };
  return {
    p25: round4dp(p25),
    p75: round4dp(p75),
    p10: round4dp(p10),
    p90: round4dp(p90),
    cov2575Loo: cover(loo.preds, loo.actuals, p25, p75),
    cov1090Loo: cover(loo.preds, loo.actuals, p10, p90),
    cov2575Wf: cover(wf.preds, wf.actuals, p25, p75),
    cov1090Wf: cover(wf.preds, wf.actuals, p10, p90),
  };
}

// ---------------------------------------------------------------- bootstrap

/** A deterministic PRNG (mulberry32) so the bootstrap refits are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap standard errors: refit the size curve on resampled live sets
 * (same size, drawn with replacement) and take the spread of each
 * coefficient across the refits.
 */
export function bootstrapSizeCurve(
  live: SnapshotProtocol[],
  model: ModelConstants,
): { interceptSe: number; slopeSe: number } {
  const rand = mulberry32(20261114);
  const intercepts: number[] = [];
  const slopes: number[] = [];
  for (let r = 0; r < model.bootstrap_refits; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const fit = fitSizeCurve(sample, model);
    intercepts.push(fit.intercept);
    slopes.push(fit.slope);
  }
  const sd = (xs: number[]): number => {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, v) => s + (v - m) * (v - m), 0) / xs.length);
  };
  return { interceptSe: round4dp(sd(intercepts)), slopeSe: round4dp(sd(slopes)) };
}

// ---------------------------------------------------------------- token odds

/** The dated peers: every protocol with a listing date, token or not. */
function datedPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
}

/** One odds term: its feature for a protocol. */
export interface OddsTermSpec {
  key: string;
  label: string;
  feature: (p: SnapshotProtocol, asOf: string, catShare: Map<string, number>, medianAgeYears: number) => number;
}

/** The candidate odds terms, in the order they are tested. */
export function oddsTermSpecs(model: ModelConstants = MODEL): OddsTermSpec[] {
  return [
    {
      key: 'age',
      label: 'age, years listed',
      feature: (p, asOf, _cs, medAge) => (ageDays(asOf, p.listed_at) ?? Math.round(medAge * 365)) / 365,
    },
    {
      key: 'size',
      label: 'size curve, ln TVL',
      feature: (p) => Math.log10(p.tvl_usd),
    },
    {
      key: 'growth',
      label: '7-day TVL growth',
      feature: (p) =>
        p.change_7d === null || !Number.isFinite(p.change_7d)
          ? 0
          : Math.tanh(clampValue(p.change_7d, model.growth_floor, model.growth_cap) / 100),
    },
    {
      key: 'cat',
      label: 'category token share, shrunk',
      feature: (p, _asOf, catShare) => catShare.get(p.category ?? 'Other') ?? 0,
    },
  ];
}

/** A category's shrunk token share among the training peers (prior weight 6 on the base rate). */
function categoryTokenShare(train: SnapshotProtocol[]): { map: Map<string, number>; base: number } {
  const counts = new Map<string, { n: number; t: number }>();
  let n = 0;
  let t = 0;
  for (const p of train) {
    const e = counts.get(p.category ?? 'Other') ?? { n: 0, t: 0 };
    e.n++;
    if (hasTokenRecord(p)) e.t++;
    counts.set(p.category ?? 'Other', e);
    n++;
    if (hasTokenRecord(p)) t++;
  }
  const base = n === 0 ? 0 : t / n;
  const map = new Map<string, number>();
  for (const [c, e] of counts) map.set(c, (e.t + 6 * base) / (e.n + 6));
  return { map, base };
}

/** A fitted logistic model: weights over standardised features plus the standardisation. */
interface FittedOdds {
  weights: number[];
  means: number[];
  sds: number[];
  keys: string[];
  catShare: Map<string, number>;
  baseRate: number;
  medianAgeYears: number;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-clampValue(z, -30, 30)));

/**
 * Fit the odds model on a training set by plain gradient descent (fixed
 * step, fixed iterations: deterministic, no randomness, no dependencies).
 */
function fitOddsModel(
  train: SnapshotProtocol[],
  asOf: string,
  keys: string[],
  specs: OddsTermSpec[],
  model: ModelConstants,
): FittedOdds {
  const { map: catShare, base } = categoryTokenShare(train);
  const datedAges = train.map((p) => (ageDays(asOf, p.listed_at) ?? 365) / 365);
  const medianAgeYears = medianOf(datedAges);
  const raw = train.map((p) =>
    keys.map((k) => specs.find((s) => s.key === k)!.feature(p, asOf, catShare, medianAgeYears)),
  );
  const y = train.map((p) => (hasTokenRecord(p) ? 1 : 0));
  const k = keys.length;
  const means = raw[0]!.map((_, j) => raw.reduce((s, r) => s + r[j]!, 0) / raw.length);
  const sds = raw[0]!.map(
    (_, j) => Math.sqrt(raw.reduce((s, r) => s + (r[j]! - means[j]!) * (r[j]! - means[j]!), 0) / raw.length) || 1,
  );
  const x = raw.map((r) => r.map((v, j) => (v - means[j]!) / sds[j]!));
  const weights = Array(k + 1).fill(0);
  const step = 0.5 / x.length;
  for (let it = 0; it < 2000; it++) {
    const grad = Array(k + 1).fill(0);
    for (let i = 0; i < x.length; i++) {
      const z = weights[0]! + x[i]!.reduce((s, v, j) => s + v * weights[j + 1]!, 0);
      const err = sigmoid(z) - y[i]!;
      grad[0] += err;
      for (let j = 0; j < k; j++) grad[j + 1]! += err * x[i]![j]!;
    }
    for (let j = 0; j <= k; j++) weights[j]! -= step * grad[j]!;
  }
  return { weights, means, sds, keys, catShare, baseRate: base, medianAgeYears };
}

/** One protocol's token odds under a fitted odds model. */
function predictOdds(p: SnapshotProtocol, asOf: string, fitted: FittedOdds, specs: OddsTermSpec[]): number {
  const raw = fitted.keys.map((k) =>
    specs.find((s) => s.key === k)!.feature(p, asOf, fitted.catShare, fitted.medianAgeYears),
  );
  const z =
    fitted.weights[0]! +
    raw.reduce((s, v, j) => s + ((v - fitted.means[j]!) / fitted.sds[j]!) * fitted.weights[j + 1]!, 0);
  return clampValue(sigmoid(z), 0.001, 0.999);
}

/** The Brier score of a set of predicted probabilities against 0/1 outcomes. */
function brierScore(preds: number[], outcomes: number[]): number {
  if (preds.length === 0) return 0;
  return preds.reduce((s, p, i) => s + (p - outcomes[i]!) * (p - outcomes[i]!), 0) / preds.length;
}

/**
 * Select the odds terms. Each candidate is tried in addition order on top
 * of the terms already kept; it stays only when it lowers BOTH Brier scores
 * (ten-fold and walk-forward) against the model without it. The base rate
 * alone is the baseline the whole model must beat.
 */
export function selectOddsTerms(
  peers: SnapshotProtocol[],
  asOf: string,
  specs: OddsTermSpec[],
  model: ModelConstants,
): {
  terms: OddsTermResult[];
  kept: string[];
  baseRate: number;
  baseTenFold: number;
  baseWalkForward: number;
  finalTenFold: number;
  finalWalkForward: number;
  calledRightPct: number;
  wfN: { train: number; test: number };
} {
  const outcomes = peers.map((p) => (hasTokenRecord(p) ? 1 : 0));
  const baseRate = outcomes.reduce((s, v) => s + v, 0) / outcomes.length;
  const baseTenFold = brierScore(outcomes.map(() => baseRate), outcomes);
  const split = Math.floor(peers.length * 0.6);
  const wfTrain = peers.slice(0, split);
  const wfTest = peers.slice(split);
  const wfBaseRate = wfTrain.filter((p) => hasTokenRecord(p)).length / wfTrain.length;
  const baseWalkForward = brierScore(
    wfTest.map(() => wfBaseRate),
    wfTest.map((p) => (hasTokenRecord(p) ? 1 : 0)),
  );
  const scoreWith = (keys: string[]): { tenFold: number; wf: number; calledRight: number } => {
    // Ten-fold, by listing order so each fold spans the whole timeline.
    const preds: number[] = [];
    const outs: number[] = [];
    for (let f = 0; f < model.odds_folds; f++) {
      const test = peers.filter((_, i) => i % model.odds_folds === f);
      const train = peers.filter((_, i) => i % model.odds_folds !== f);
      const fitted = fitOddsModel(train, asOf, keys, specs, model);
      for (const p of test) {
        preds.push(predictOdds(p, asOf, fitted, specs));
        outs.push(hasTokenRecord(p) ? 1 : 0);
      }
    }
    const fittedWf = fitOddsModel(wfTrain, asOf, keys, specs, model);
    const wfPreds = wfTest.map((p) => predictOdds(p, asOf, fittedWf, specs));
    const wfOuts = wfTest.map((p) => (hasTokenRecord(p) ? 1 : 0));
    const calledRight = preds.filter((p, i) => (p >= 0.5 ? 1 : 0) === outs[i]).length / preds.length;
    return { tenFold: brierScore(preds, outs), wf: brierScore(wfPreds, wfOuts), calledRight };
  };
  const terms: OddsTermResult[] = [];
  const kept: string[] = [];
  let calledRightPct = 0;
  let curScore = { tenFold: baseTenFold, wf: baseWalkForward, calledRight: 0 };
  for (const spec of specs) {
    const trial = [...kept, spec.key];
    const withTerm = scoreWith(trial);
    const without = curScore;
    const keep = withTerm.tenFold < without.tenFold && withTerm.wf < without.wf;
    if (keep) {
      kept.push(spec.key);
      calledRightPct = withTerm.calledRight;
      curScore = withTerm;
    }
    terms.push({
      term: spec.key,
      label: spec.label,
      brier_ten_fold: round4dp(withTerm.tenFold),
      brier_walk_forward: round4dp(withTerm.wf),
      kept: keep,
    });
  }
  if (kept.length === 0) calledRightPct = outcomes.filter((o) => o === 0).length / outcomes.length;
  return {
    terms,
    kept,
    baseRate: round4dp(baseRate),
    baseTenFold: round4dp(baseTenFold),
    baseWalkForward: round4dp(baseWalkForward),
    finalTenFold: round4dp(curScore.tenFold),
    finalWalkForward: round4dp(curScore.wf),
    calledRightPct: round4dp(calledRightPct),
    wfN: { train: wfTrain.length, test: wfTest.length },
  };
}

/**
 * The odds peer-set experiment. The odds model is fitted and scored twice:
 * once on the full dated set, once on the stand-alone subset (the peers
 * isStandAlonePeer keeps). The restricted set is adopted only when it beats
 * the full set on BOTH Brier scores — ten-fold and walk-forward. A win on
 * one test alone is not enough: the two tests price different peer
 * populations (the restricted set drops 262 of the 645 dated peers), so a
 * split result says the restriction changes who is being scored as much as
 * how well, and the full set — the peers' whole record — stays. Either way
 * the comparison is returned, so the evidence payload records that the test
 * was run and what it said.
 */
export function compareOddsPeerSets(
  peers: SnapshotProtocol[],
  asOf: string,
  specs: OddsTermSpec[],
  model: ModelConstants,
): {
  test: OddsPeerSetTest;
  adoptedPeers: SnapshotProtocol[];
  adoptedSelection: ReturnType<typeof selectOddsTerms>;
} {
  const restricted = peers.filter(isStandAlonePeer);
  const fullSelection = selectOddsTerms(peers, asOf, specs, model);
  const restrictedSelection = selectOddsTerms(restricted, asOf, specs, model);
  const adopted: 'full' | 'stand-alone' =
    restrictedSelection.finalTenFold < fullSelection.finalTenFold &&
    restrictedSelection.finalWalkForward < fullSelection.finalWalkForward
      ? 'stand-alone'
      : 'full';
  const note =
    `Stand-alone peer set tested (${restricted.length} of ${peers.length} dated peers): ` +
    `ten-fold Brier ${restrictedSelection.finalTenFold} vs ${fullSelection.finalTenFold} full, ` +
    `walk-forward ${restrictedSelection.finalWalkForward} vs ${fullSelection.finalWalkForward} full — ` +
    (adopted === 'stand-alone'
      ? 'restricted set adopted: it beat the full set on both Brier scores.'
      : 'full set kept: the restricted set did not beat it on both Brier scores.');
  return {
    test: {
      adopted,
      full_peers: peers.length,
      full_token_peers: peers.filter((p) => hasTokenRecord(p)).length,
      full_brier_ten_fold: fullSelection.finalTenFold,
      full_brier_walk_forward: fullSelection.finalWalkForward,
      restricted_peers: restricted.length,
      restricted_token_peers: restricted.filter((p) => hasTokenRecord(p)).length,
      restricted_brier_ten_fold: restrictedSelection.finalTenFold,
      restricted_brier_walk_forward: restrictedSelection.finalWalkForward,
      note,
    },
    adoptedPeers: adopted === 'stand-alone' ? restricted : peers,
    adoptedSelection: adopted === 'stand-alone' ? restrictedSelection : fullSelection,
  };
}

// ---------------------------------------------------------------- farm verdicts

/** How much capital one farm position needs, from the protocol's own TVL. */
function depositFor(p: SnapshotProtocol, model: ModelConstants): number {
  for (const tier of model.deposit_tiers) {
    if (p.tvl_usd >= tier.atLeast) return tier.deposit;
  }
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The costed farm verdict for one row. Expected drop = implied value x the
 * drop share the reader picks (default 5% of the launch's value set aside
 * for farmers) x one active farmer's share of that pool (0.05%). Fees are
 * gas plus a slice of the deposit; the capital charge is 6% a year on the
 * deposit for the hold; the work is six hours at $15 an hour. FARM when the
 * net per hour clears $20, MARGINAL when the net is positive but below it,
 * SKIP when it is negative. Every input is printed on the page, and the
 * reader's slider changes the drop share live.
 */
export function farmVerdict(
  impliedValueUsd: number,
  p: SnapshotProtocol,
  age: number | null,
  dropSharePct: number,
  model: ModelConstants,
): BoardRow['farm'] {
  const deposit = depositFor(p, model);
  const hold = holdDaysFor(age);
  const expectedDrop = impliedValueUsd * (dropSharePct / 100) * model.farmer_rate;
  const fees = model.gas_usd + model.gas_pct * deposit;
  const capitalCharge = deposit * (model.capital_rate_pct / 100) * (hold / 365);
  const hours = model.work_hours;
  const net = expectedDrop - fees - capitalCharge - hours * model.hourly_usd;
  const netPerHour = net / hours;
  const verdict: BoardRow['farm']['verdict'] =
    netPerHour >= model.farm_bar_per_hour ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
  return {
    deposit_usd: deposit,
    hold_days: hold,
    expected_drop_usd: round2dp(expectedDrop),
    fees_usd: round2dp(fees),
    capital_charge_usd: round2dp(capitalCharge),
    hours,
    net_usd: round2dp(net),
    net_per_hour_usd: round2dp(netPerHour),
    verdict,
  };
}

// ---------------------------------------------------------------- farm steps

/** The first chain a protocol names, or a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  const first = p.chains[0];
  return first === undefined ? 'its main chain' : first;
}

/** One farm action: the category's main step, written for the farmer to follow. */
type FarmActionFn = (name: string, capital: number, chain: string) => string;

/** The main action per category, first match wins; the table order is the priority order. */
const PRIMARY_FARM_ACTIONS: { match: string[]; run: FarmActionFn }[] = [
  { match: ['lend', 'cdp', 'collateral'], run: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it accrues interest.` },
  { match: ['dex', 'yield', 'leveraged farm'], run: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { match: ['perpetual', 'derivative'], run: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.` },
  { match: ['prediction'], run: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}, then close it after settlement.` },
  { match: ['curator', 'allocator', 'risk'], run: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares until the vault's epoch ends.` },
  { match: ['stable'], run: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.` },
  { match: ['rwa'], run: (name, capital, chain) => `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it through one payout.` },
  { match: ['insurance'], run: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.` },
  { match: ['launchpad'], run: (name, capital, chain) => `Commit $${capital} of USDC to ${name}'s next sale on ${chain} and hold the allocation.` },
  { match: ['basis'], run: (name, capital, chain) => `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.` },
];

/** The category's main action, in the words a farmer can follow. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const entry of PRIMARY_FARM_ACTIONS) {
    if (entry.match.some((key) => category.includes(key))) return entry.run(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** The category's second, different action: a weekly touch that proves the wallet is active. */
const WEEKLY_FARM_ACTIONS: { match: string[]; run: FarmActionFn }[] = [
  { match: ['lend', 'cdp', 'collateral'], run: (name, capital, chain) => `Borrow $10 of USDC against your ${name} supply on ${chain}, repay it the same week, and leave the supply open.` },
  { match: ['dex', 'yield', 'leveraged farm'], run: (name, capital, chain) => `Swap $10 through ${name}'s main pool on ${chain} and claim any fees the position earned.` },
  { match: ['perpetual', 'derivative'], run: (name, capital, chain) => `Close and reopen one small position on ${name} so the account shows a fresh trade each week.` },
  { match: ['prediction'], run: (name, capital, chain) => `Settle one finished market on ${name} and place a fresh $5 position on the next one.` },
  { match: ['curator', 'allocator', 'risk'], run: (name, capital, chain) => `Rebalance $${capital} between two ${name} vaults on ${chain} once a month and keep the shares.` },
  { match: ['stable'], run: (name, capital, chain) => `Swap $10 into and out of the stable asset on ${name} so the wallet shows two-way activity.` },
  { match: ['rwa'], run: (name, capital, chain) => `Claim one payout from ${name} on ${chain} and redeposit it into the same asset.` },
  { match: ['insurance'], run: (name, capital, chain) => `Renew or top up $${capital} of cover on ${name} before the policy lapses.` },
  { match: ['launchpad'], run: (name, capital, chain) => `Vote or stake the allocation receipt on ${name} so the account stays active between sales.` },
  { match: ['basis'], run: (name, capital, chain) => `Claim one funding payout from ${name} on ${chain} and leave the vault position open.` },
];

function weeklyAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const entry of WEEKLY_FARM_ACTIONS) {
    if (entry.match.some((key) => category.includes(key))) return entry.run(p.name, capital, chain);
  }
  return `Make one small swap or deposit of about $10 on ${p.name} so the wallet shows a fresh action each week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a day, a cost and
 * a time, derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. The last step is the exit:
 * a farm with no unwind plan is a position you cannot leave.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, deposit: number, hold: number): string[] {
  const chain = primaryChain(p);
  const secondCapital = Math.max(25, Math.floor(deposit / 2));
  const otherChain = p.chains.length > 1 ? p.chains[1]! : null;
  const setupGas = deposit >= 150 ? 8 : 4;
  const plan: { day: string; text: string; cost: string; time: string }[] = [
    {
      day: 'Day 0',
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      day: 'Day 0',
      text: primaryAction(p, deposit, chain),
      cost: `$${deposit} of capital and about $${setupGas} of gas`,
      time: '15 minutes to set up',
    },
    otherChain === null
      ? {
          day: 'Weekly',
          text: weeklyAction(p, deposit, chain),
          cost: 'about $2 of gas a week',
          time: '10 minutes a week',
        }
      : {
          day: 'Day 1',
          text: `Repeat the same deposit on ${otherChain} with $${secondCapital} so the wallet is active on a second chain ${p.name} supports.`,
          cost: `$${secondCapital} of capital and about $4 of gas`,
          time: '15 minutes to set up',
        },
    {
      day: `Day 1-${hold}`,
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${deposit} stays in the position`,
      time: `${hold} days`,
    },
    {
      day: 'Weekly',
      text: `Open the protocol's own points or rewards page from its official site and check the wallet shows the position; never connect the wallet to a link from a message or a search ad.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      day: 'Before exit',
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      day: 'Exit',
      text: `Plan the exit now: unwind in two halves a week apart so one failed withdrawal never strands the whole position, and write the wallet, the dates and every transaction hash in a farm log.`,
      cost: 'about $4 of gas to unwind',
      time: '10 minutes a week apart',
    },
  ];
  return plan.map((step) => {
    let line = `${step.day} — ${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (line.length > 600) line = `${line.slice(0, 596)}...`;
    return line;
  });
}

// ---------------------------------------------------------------- ledger

/**
 * The 758-protocol ledger: every snapshot protocol in exactly one group,
 * defined from the snapshot's own fields and the house list's rules. The
 * counts are computed here, never typed in, and the dashboard checks the
 * groups add up to the snapshot's protocol count.
 */
export function buildLedger(snapshot: Snapshot, boardSlugs: Set<string>): LedgerGroup[] {
  const watchlist = new Set(snapshot.watchlist);
  let rankedWatchlist = 0;
  let rankedEarly = 0;
  let tokenTrades = 0;
  let tokenRecordedNoCap = 0;
  let outBridge = 0;
  let outLiquidStaking = 0;
  let outExchange = 0;
  let outVersionedWrapped = 0;
  let outNoCategory = 0;
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug)) {
      if (watchlist.has(p.slug)) rankedWatchlist++;
      else rankedEarly++;
    } else if (p.mcap_usd !== null && p.mcap_usd > 0) {
      tokenTrades++;
    } else if (p.gecko_id !== null || p.symbol !== null) {
      tokenRecordedNoCap++;
    } else if (p.category === 'Bridge' || p.category === 'Canonical Bridge') {
      outBridge++;
    } else if (
      p.category === 'Liquid Staking' ||
      p.category === 'Liquid Restaking' ||
      p.category === 'Restaked BTC'
    ) {
      outLiquidStaking++;
    } else if (p.category === 'CEX') {
      outExchange++;
    } else if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name)) {
      outVersionedWrapped++;
    } else {
      outNoCategory++;
    }
  }
  return [
    { key: 'ranked-watchlist', label: 'Ranked, watchlist', count: rankedWatchlist },
    { key: 'ranked-early', label: 'Ranked, early below the floor', count: rankedEarly },
    { key: 'token-trades', label: 'Token trades, priced comp', count: tokenTrades },
    { key: 'token-recorded', label: 'Token recorded, no usable cap', count: tokenRecordedNoCap },
    { key: 'out-bridge', label: 'Out, bridge', count: outBridge },
    { key: 'out-liquid-staking', label: 'Out, liquid staking', count: outLiquidStaking },
    { key: 'out-exchange', label: 'Out, exchange', count: outExchange },
    { key: 'out-versioned', label: 'Out, versioned or wrapped', count: outVersionedWrapped },
    { key: 'out-no-category', label: 'Out, no category', count: outNoCategory },
  ];
}

// ---------------------------------------------------------------- checksum

/** FNV-1a 32-bit hash, hex: the short checksum the dashboard recomputes in the browser. */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  const bytes = Buffer.from(text, 'utf8');
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- build

/** Strongest implied value first, slug as the tie-break so the order is deterministic. */
function byImpliedThenSlug(
  a: { implied: number; p: SnapshotProtocol },
  b: { implied: number; p: SnapshotProtocol },
): number {
  return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/** The live-token protocols, by market cap, for the dashboard's comp table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const byMarketCap = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd;
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(byMarketCap)
    .slice(0, 12)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan and economics included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.model.launch_value_usd,
    token_odds: row.model.token_odds,
    odds_age_known: row.model.odds_age_known,
    size_base: row.model.size_base,
    cat_factor: row.model.cat_factor,
    comp_members: row.model.comp_members,
    level_factor: row.model.level_factor,
    range_p25_usd: row.model.range_p25_usd,
    range_p75_usd: row.model.range_p75_usd,
    range_p10_usd: row.model.range_p10_usd,
    range_p90_usd: row.model.range_p90_usd,
    deposit_usd: row.farm.deposit_usd,
    hold_days: row.farm.hold_days,
    expected_drop_usd: row.farm.expected_drop_usd,
    fees_usd: row.farm.fees_usd,
    capital_charge_usd: row.farm.capital_charge_usd,
    hours: row.farm.hours,
    net_usd: row.farm.net_usd,
    net_per_hour_usd: row.farm.net_per_hour_usd,
    verdict: row.farm.verdict,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const live = liveSet(snapshot, model);
  const fit = fitSizeCurve(snapshot.protocols, model);
  if (fit.slope >= 0) throw new SnapshotError('size curve slope is not negative: the live set shows no size effect to calibrate from');

  // The value experiment: term selection, then the level decision, then the ranges.
  const specs = termSpecs(model);
  const selection = selectValueTerms(live, snapshot.as_of, specs, model);
  const keptKeys = selection.kept;
  const loo = leaveOneOut(live, snapshot.as_of, keptKeys, specs, model);
  const wf = walkForward(live, snapshot.as_of, keptKeys, specs, model);
  const level = levelFromHeldOut(loo);
  const ranges = rangesFromHeldOut(loo, wf, model);
  const boot = bootstrapSizeCurve(live, model);
  const finalFit = fitValueModel(live, snapshot.as_of, keptKeys, specs, model);
  const catHere = categoryMap(live, fit, model);

  // The odds experiment: the peer-set test first, then term selection on
  // the adopted set, then the full fit on that same set.
  const peers = datedPeers(snapshot);
  const oddsSpecs = oddsTermSpecs(model);
  const peerSet = compareOddsPeerSets(peers, snapshot.as_of, oddsSpecs, model);
  const oddsSelection = peerSet.adoptedSelection;
  const oddsPeers = peerSet.adoptedPeers;
  const oddsFitted = fitOddsModel(oddsPeers, snapshot.as_of, oddsSelection.kept, oddsSpecs, model);

  // The board: watchlist first as the floor, then every other rankable protocol.
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  for (const proto of snapshot.protocols) {
    if (!chosen.has(proto.slug) && isRankable(proto)) chosen.set(proto.slug, proto);
  }

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const launchRaw = predictLaunch(p, snapshot.as_of, finalFit, specs);
    const launch = Math.max(1, Math.round(launchRaw * level.level));
    const odds = predictOdds(p, snapshot.as_of, oddsFitted, oddsSpecs);
    const implied = Math.max(1, Math.round(launch * odds));
    const sizeBase = round4dp(sizeBaseFor(p.tvl_usd, fit));
    const catFactor = p.category === null ? null : round4dp(catHere.get(p.category) ?? 0);
    const compMembers = live.filter((q) => q.category === p.category).length;
    const farm = farmVerdict(implied, p, age, model.drop_share_pct, model);
    const steps = farmSteps(p, age, farm.deposit_usd, farm.hold_days);
    return {
      p,
      age,
      launch,
      odds: round4dp(odds),
      implied,
      sizeBase,
      catFactor,
      compMembers,
      farm,
      steps,
    };
  });
  scored.sort(byImpliedThenSlug);
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      launch_value_usd: s.launch,
      token_odds: s.odds,
      odds_age_known: s.age !== null,
      size_base: s.sizeBase,
      cat_factor: s.catFactor,
      comp_members: s.compMembers,
      level_factor: level.level,
      range_p25_usd: Math.max(1, Math.round(s.implied * Math.pow(10, ranges.p25))),
      range_p75_usd: Math.max(1, Math.round(s.implied * Math.pow(10, ranges.p75))),
      range_p10_usd: Math.max(1, Math.round(s.implied * Math.pow(10, ranges.p10))),
      range_p90_usd: Math.max(1, Math.round(s.implied * Math.pow(10, ranges.p90))),
      age_days: s.age,
      growth_pct: s.p.change_7d,
    },
    farm: s.farm,
    farm_steps: s.steps,
  }));

  const boardSlugs = new Set(board.map((r) => r.slug));
  const ledger = buildLedger(snapshot, boardSlugs);
  const ledgerTotal = ledger.reduce((s, g) => s + g.count, 0);
  if (ledgerTotal !== snapshot.protocols.length) {
    throw new SnapshotError(`ledger adds to ${ledgerTotal}, not ${snapshot.protocols.length}: a protocol sits in no group`);
  }
  const verdictCounts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.farm.verdict]++;
  const radarRows = board.map(radarRow);
  // The checksum covers exactly the rows the page renders, so the browser
  // can recompute it from data.js and compare it with this value.
  const checksum = fnv1aHex(JSON.stringify(radarRows));
  const oddsList = board.map((r) => r.model.token_odds).sort((a, b) => a - b);
  const oddsMedian = oddsList[Math.floor(oddsList.length / 2)] ?? 0;
  const oddsP75 = oddsList[Math.floor(oddsList.length * 0.75)] ?? 0;

  const valueEvidence: ValueEvidence = {
    members: live.length,
    dated_members: live.filter((p) => p.listed_at !== null).length,
    walk_forward_train: wf.trainN,
    walk_forward_test: wf.testN,
    flat_loo_miss: round4dp(selection.flat.loo),
    flat_walk_forward_miss: round4dp(selection.flat.wf),
    base_loo_miss: round4dp(selection.base.loo),
    base_walk_forward_miss: round4dp(selection.base.wf),
    base_within_3x_loo: loo.within3,
    base_within_3x_walk_forward: wf.within3,
    level_factor: level.level,
    level_applied: level.applied,
    level_loo_before: level.before,
    level_loo_after: level.after,
    level_median_signed_log_error: level.medianSigned,
    terms: selection.terms,
    kept_terms: keptKeys,
    coefficients: [
      { name: 'intercept', value: round4dp(finalFit.beta[0]!), se: boot.interceptSe },
      { name: 'log10 TVL slope', value: round4dp(finalFit.beta[1]!), se: boot.slopeSe },
      ...keptKeys.map((k, j) => ({
        name: specs.find((s) => s.key === k)!.label,
        value: round4dp(finalFit.beta[j + 2]!),
        se: 0,
      })),
    ],
    range_p25: ranges.p25,
    range_p75: ranges.p75,
    range_p10: ranges.p10,
    range_p90: ranges.p90,
    coverage_p25_p75_loo: ranges.cov2575Loo,
    coverage_p10_p90_loo: ranges.cov1090Loo,
    coverage_p25_p75_walk_forward: ranges.cov2575Wf,
    coverage_p10_p90_walk_forward: ranges.cov1090Wf,
  };
  const oddsEvidence: OddsEvidence = {
    peers: oddsPeers.length,
    token_peers: oddsPeers.filter((p) => hasTokenRecord(p)).length,
    base_rate: oddsSelection.baseRate,
    base_brier_ten_fold: oddsSelection.baseTenFold,
    base_brier_walk_forward: oddsSelection.baseWalkForward,
    brier_ten_fold: oddsSelection.finalTenFold,
    brier_walk_forward: oddsSelection.finalWalkForward,
    walk_forward_train: oddsSelection.wfN.train,
    walk_forward_test: oddsSelection.wfN.test,
    peer_set: peerSet.test.adopted,
    peer_set_note: peerSet.test.note,
    peer_set_test: peerSet.test,
    called_right_ten_fold_pct: oddsSelection.calledRightPct,
    age_bands: (['<1y', '1-2y', '2-3y', '3y+'] as const).map((band) => {
      const inBand = oddsPeers.filter((p) => {
        const years = (ageDays(snapshot.as_of, p.listed_at) ?? 365) / 365;
        return band === '<1y' ? years < 1 : band === '1-2y' ? years >= 1 && years < 2 : band === '2-3y' ? years >= 2 && years < 3 : years >= 3;
      });
      const token = inBand.filter((p) => hasTokenRecord(p)).length;
      return { band, peers: inBand.length, token_rate: inBand.length === 0 ? 0 : round4dp(token / inBand.length) };
    }),
    terms: oddsSelection.terms,
    kept_terms: oddsSelection.kept,
    coefficients: [
      { name: 'intercept', value: round4dp(oddsFitted.weights[0]!) },
      ...oddsSelection.kept.map((k, j) => ({
        name: oddsSpecs.find((s) => s.key === k)!.label,
        value: round4dp(oddsFitted.weights[j + 1]!),
      })),
    ],
    odds_median: round4dp(oddsMedian),
    odds_p75: round4dp(oddsP75),
    odds_max: round4dp(oddsList[oddsList.length - 1] ?? 0),
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length,
    checksum,
    size_fit: fit,
    value: valueEvidence,
    odds: oddsEvidence,
    ledger,
    verdict_counts: verdictCounts,
    watchlist: snapshot.watchlist,
    rows: radarRows,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

// ---------------------------------------------------------------- snapshot + gate

/** Refuse a snapshot with this message: every bad shape fails the same way. */
function refuse(message: string): never {
  throw new SnapshotError(message);
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    refuse('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) refuse('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') refuse('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) refuse('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) refuse('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) refuse('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) refuse(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      refuse(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) if (step.trim().length < 20 || step.trim().length > 600) return `${row.slug} has a farm step of ${step.trim().length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
