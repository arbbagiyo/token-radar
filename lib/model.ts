// Token Radar, radar-4 — the scoring model.
//
// A sealed DefiLlama snapshot goes in; a ranked board of pre-token protocols
// comes out. The ranking is a pure function of the snapshot: nothing is
// fetched, nothing is special-cased by name, and two runs on the same input
// write the same bytes.
//
// The pipeline, in order:
//
//   1. Fit the size curve. Take the protocols that already trade, winsorise
//      each live market-cap/TVL ratio into [0.005, 5], and run least squares
//      on log10(ratio) against log10(TVL). Large protocols trade at smaller
//      multiples than small ones, so the curve — never a flat median — sets
//      the base multiple for a protocol of a given size.
//   2. Price each category. A category's factor is the median of its live
//      members' residuals from the curve, shrunk toward 1 with a prior
//      weight of 6 and clamped to [0.25, 2.5]. One odd live protocol cannot
//      set its whole category's multiple, and a category with no live member
//      gets a factor of 1.
//   3. Score every rankable pre-token protocol. implied = TVL x comp x
//      growth x maturity x breadth x level. comp is the size base times the
//      category factor, clamped to [0.01, 1.2]; growth is a bounded tanh of
//      the 7-day change; maturity grows with the protocol's age, with a
//      haircut for listings under 90 days; breadth adds a little for running
//      on several chains.
//   4. Centre the model. Score the live set without the level factor, take
//      the median signed log error, and set level = 10^(-that median), so the
//      backtest's median bias is zero. The level is recomputed from the live
//      set on every run, never hardcoded.
//   5. Rank the board by implied value, strongest first, with a slug
//      tie-break so the order is deterministic.
//
// The backtest scores the same 128 live protocols with the finished model and
// compares against their real market caps. It is in-sample by construction —
// the live set is what calibrates the multiples — so the dashboard labels it
// a calibration check, not a prediction. The dashboard also prints the
// formula and recomputes every row's factors from the snapshot figures, so
// the page and board.json can be checked against each other.

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
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  unknown_growth_discount: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  young_age_days: number;
  young_discount: number;
  breadth_step: number;
  breadth_max_extra_chains: number;
  comp_floor: number;
  comp_cap: number;
  cat_factor_floor: number;
  cat_factor_cap: number;
  shrink_prior: number;
  winsor_low: number;
  winsor_high: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 6,
  comp_floor: 0.01,
  comp_cap: 1.2,
  cat_factor_floor: 0.25,
  cat_factor_cap: 2.5,
  winsor_low: 0.005,
  winsor_high: 5,
  growth_weight: 0.3,
  growth_floor: -90,
  growth_cap: 900,
  unknown_growth_discount: 0.97,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  young_age_days: 90,
  young_discount: 0.9,
  breadth_step: 0.02,
  breadth_max_extra_chains: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The least-squares line for log10(market-cap/TVL) on log10(TVL), fit on the live set. */
export interface SizeFit {
  members: number;
  intercept: number;
  slope: number;
}

/** The model's own backtest: the live protocols scored as if they were pre-token. */
export interface Backtest {
  members: number;
  within_3x: number;
  within_10x: number;
  median_factor_error: number;
  /** Median signed log10(implied/mcap) before the level correction (negative = under-predicts). */
  median_signed_log_error: number;
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
    comp_ratio: number;
    size_base: number;
    cat_factor: number;
    comp_members: number;
    growth_pct: number | null;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    level_factor: number;
    young: boolean;
    growth_reported: boolean;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
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
  comp_ratio: number;
  size_base: number;
  cat_factor: number;
  comp_members: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  level_factor: number;
  young: boolean;
  growth_reported: boolean;
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

/** Everything the dashboard needs: the board, the live set, the comps and the model. */
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
  global_comp: number;
  size_fit: SizeFit;
  backtest: Backtest;
  level_factor: number;
  watchlist: string[];
  comps: { category: string; members: number; factor: number; median_residual: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The factors and the implied value one protocol gets, at a given level factor. */
export interface ScoredProtocol {
  implied: number;
  comp: number;
  sizeBase: number;
  catFactor: number;
  compMembers: number;
  growthPct: number | null;
  growthMult: number;
  growthReported: boolean;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  young: boolean;
}

/** The board plus everything the dashboard needs from the scoring run. */
export interface BuiltBoard {
  board: BoardRow[];
  fit: SizeFit;
  level: number;
  backtest: Backtest;
  factors: Map<string, { factor: number; members: number; median_residual: number }>;
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

/** Clamp into [low, high]; NaN passes through unchanged, as Math.min/max would leave it. */
function clampValue(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** The median of a set of numbers, or null when it is empty. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
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
  const hasToken = p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
  return !hasToken;
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

/**
 * The size curve: least squares through the live protocols' log10 ratio on log10 TVL.
 * A slope at or above zero would mean the size effect is absent, and the caller
 * refuses the board rather than scoring on a broken fit.
 */
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

/**
 * The category factors: each category's median residual from the size curve, shrunk
 * toward 1 with the prior weight, then clamped. A one-member category keeps only
 * 1/(1+prior) of its residual, so a single odd live protocol cannot set its whole
 * category's multiple.
 */
export function categoryFactors(
  protocols: SnapshotProtocol[],
  fit: SizeFit,
  model: ModelConstants = MODEL,
): Map<string, { factor: number; members: number; median_residual: number }> {
  const residuals = new Map<string, number[]>();
  for (const p of protocols) {
    const r = liveRatio(p, model);
    if (r === null) continue;
    const key = p.category ?? 'Other';
    const list = residuals.get(key) ?? [];
    list.push(Math.log10(r) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd)));
    residuals.set(key, list);
  }
  const out = new Map<string, { factor: number; members: number; median_residual: number }>();
  for (const [category, rs] of residuals) {
    const med = medianOf(rs);
    if (med === null) continue;
    const shrunk = (rs.length * med) / (rs.length + model.shrink_prior);
    const factor = clampValue(Math.pow(10, shrunk), model.cat_factor_floor, model.cat_factor_cap);
    out.set(category, { factor: round4dp(factor), members: rs.length, median_residual: round4dp(med) });
  }
  return out;
}

/** The global median live ratio, for reference: the dashboard names it beside the size curve. */
export function globalComp(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): number {
  const ratios = protocols
    .map((p) => liveRatio(p, model))
    .filter((r): r is number => r !== null);
  return round4dp(medianOf(ratios) ?? 0.2);
}

/** A protocol's category multiple: its size base times its category's shrunk factor, clamped. */
export function compFor(
  p: SnapshotProtocol,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  model: ModelConstants = MODEL,
): { ratio: number; sizeBase: number; catFactor: number; members: number } {
  const base = sizeBaseFor(p.tvl_usd, fit);
  const found = p.category === null ? undefined : factors.get(p.category);
  const factor = found?.factor ?? 1;
  const members = found?.members ?? 0;
  const ratio = clampValue(base * factor, model.comp_floor, model.comp_cap);
  return { ratio: round4dp(ratio), sizeBase: round4dp(base), catFactor: factor, members };
}

/**
 * The growth factor: tanh keeps a weekly spike bounded instead of letting it multiply
 * the value. An unreported 7-day change is discounted, not treated as a flat week.
 */
export function growthFactor(
  change7d: number | null,
  model: ModelConstants = MODEL,
): { pct: number | null; mult: number; reported: boolean } {
  if (change7d === null || !Number.isFinite(change7d)) {
    return { pct: null, mult: round4dp(model.unknown_growth_discount), reported: false };
  }
  const pct = clampValue(change7d, model.growth_floor, model.growth_cap);
  const mult = 1 + model.growth_weight * Math.tanh(pct / 100);
  return { pct, mult: round4dp(mult), reported: true };
}

/** The maturity factor: how long the protocol has run with no token, with a young-listing haircut. */
export function maturityFactor(
  age: number | null,
  model: ModelConstants = MODEL,
): { mult: number; young: boolean } {
  const days = age ?? model.unknown_age_days;
  const capped = clampValue(days, 0, model.maturity_days);
  const base = model.maturity_floor + (capped / model.maturity_days) * model.maturity_range;
  const young = age !== null && age < model.young_age_days;
  return { mult: round4dp(base * (young ? model.young_discount : 1)), young };
}

/** The breadth factor: one extra chain at a time, capped, for how widely the protocol runs. */
export function breadthFactor(chains: string[], model: ModelConstants = MODEL): number {
  const extra = clampValue(chains.length - 1, 0, model.breadth_max_extra_chains);
  return round4dp(1 + model.breadth_step * extra);
}

/** The factors and the implied value one protocol gets, at a given level factor. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  levelFactor: number,
  model: ModelConstants = MODEL,
): ScoredProtocol {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio: comp, sizeBase, catFactor, members: compMembers } = compFor(protocol, fit, factors, model);
  const { pct: growthPct, mult: growthMult, reported: growthReported } = growthFactor(protocol.change_7d, model);
  const { mult: maturityMult, young } = maturityFactor(age, model);
  const breadthMult = breadthFactor(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp * growthMult * maturityMult * breadthMult * levelFactor));
  return { implied, comp, sizeBase, catFactor, compMembers, growthPct, growthMult, growthReported, maturityMult, breadthMult, age, young };
}

/**
 * The level correction: score every live protocol without it, take the median signed
 * log10(implied/mcap), and return 10^(-that median) so the corrected backtest's
 * median bias is centred at zero. Computed from the live set on every run.
 */
export function levelFactorFor(
  snapshot: Snapshot,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  model: ModelConstants = MODEL,
): { level: number; median_signed_log_error: number; members: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const signed: number[] = [];
  for (const p of live) {
    const v = impliedValue(p, snapshot.as_of, fit, factors, 1, model);
    signed.push(Math.log10(v.implied / p.mcap_usd!));
  }
  const med = medianOf(signed) ?? 0;
  return { level: round4dp(Math.pow(10, -med)), median_signed_log_error: round4dp(med), members: live.length };
}

/**
 * The backtest: every live protocol scored with the same function (level included)
 * as if it had no token, against its real market cap. In-sample by construction —
 * the live set calibrates the multiples — so it is reported as a calibration check,
 * never as out-of-sample proof.
 */
export function backtest(
  snapshot: Snapshot,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  levelFactor: number,
  medianSignedLogError: number,
  model: ModelConstants = MODEL,
): Backtest {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  let within3 = 0;
  let within10 = 0;
  const errors: number[] = [];
  for (const p of live) {
    const v = impliedValue(p, snapshot.as_of, fit, factors, levelFactor, model);
    const ratio = v.implied / p.mcap_usd!;
    errors.push(Math.abs(Math.log10(ratio)));
    if (ratio > 1 / 3 && ratio < 3) within3++;
    if (ratio > 0.1 && ratio < 10) within10++;
  }
  const med = medianOf(errors) ?? 0;
  return {
    members: live.length,
    median_factor_error: round4dp(Math.pow(10, med)),
    within_3x: within3,
    within_10x: within10,
    median_signed_log_error: medianSignedLogError,
  };
}

/** Strongest implied value first, slug as the tie-break so the order is deterministic. */
function byImpliedThenSlug(
  a: { implied: number; p: SnapshotProtocol },
  b: { implied: number; p: SnapshotProtocol },
): number {
  return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BuiltBoard {
  const fit = fitSizeCurve(snapshot.protocols, model);
  if (fit.slope >= 0) throw new SnapshotError('size curve slope is not negative: the live set shows no size effect to calibrate from');
  const factors = categoryFactors(snapshot.protocols, fit, model);
  const { level, median_signed_log_error } = levelFactorFor(snapshot, fit, factors, model);
  const back = backtest(snapshot, fit, factors, level, median_signed_log_error, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: every other pre-token protocol the board can honestly score, whatever its TVL.
  for (const proto of snapshot.protocols) {
    if (!chosen.has(proto.slug) && isRankable(proto)) chosen.set(proto.slug, proto);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, factors, level, model);
    return { p, ...v };
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
      comp_ratio: s.comp,
      size_base: s.sizeBase,
      cat_factor: s.catFactor,
      comp_members: s.compMembers,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
      level_factor: level,
      age_days: s.age,
      young: s.young,
      growth_reported: s.growthReported,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, fit, level, backtest: back, factors };
}

/** The first chain a protocol names, or a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  const first = p.chains[0];
  return first === undefined ? 'its main chain' : first;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
const CAPITAL_TIERS: { atLeast: number; capital: number }[] = [
  { atLeast: 5_000_000_000, capital: 250 },
  { atLeast: 1_000_000_000, capital: 150 },
  { atLeast: 100_000_000, capital: 100 },
];

function capitalFor(p: SnapshotProtocol): number {
  for (const tier of CAPITAL_TIERS) {
    if (p.tvl_usd >= tier.atLeast) return tier.capital;
  }
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
const HOLD_TIERS: { under: number; days: number }[] = [
  { under: 180, days: 60 },
  { under: 365, days: 45 },
];

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  for (const tier of HOLD_TIERS) {
    if (age < tier.under) return tier.days;
  }
  return 30;
}

/** One farm action: the category's main step, written for the farmer to follow. */
type FarmActionFn = (name: string, capital: number, chain: string) => string;

/** The main action per category, first match wins; the table order is the priority order. */
const PRIMARY_FARM_ACTIONS: { match: string[]; run: FarmActionFn }[] = [
  { match: ['lend', 'cdp', 'collateral'], run: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it accrues interest.` },
  { match: ['dex', 'yield', 'leveraged farm'], run: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { match: ['bridge'], run: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.` },
  { match: ['staking', 'restak'], run: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.` },
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

/** The second, different action per category: a weekly touch that proves the wallet is active. */
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

/** The category's second, different action: a weekly touch that proves the wallet is active. */
function weeklyAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const entry of WEEKLY_FARM_ACTIONS) {
    if (entry.match.some((key) => category.includes(key))) return entry.run(p.name, capital, chain);
  }
  return `Make one small swap or deposit of about $10 on ${p.name} so the wallet shows a fresh action each week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names. The seventh step is the exit: a farm with no unwind plan is a position
 * you cannot leave.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = primaryChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const setupGas = capital >= 150 ? 8 : 4;
  const secondCapital = Math.max(25, Math.floor(capital / 2));
  const otherChain = p.chains.length > 1 ? p.chains[1]! : null;
  const plan: { text: string; cost: string; time: string }[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital and about $${setupGas} of gas`,
      time: '15 minutes to set up',
    },
    otherChain === null
      ? {
          text: weeklyAction(p, capital, chain),
          cost: 'about $2 of gas a week',
          time: '10 minutes a week',
        }
      : {
          text: `Repeat the same deposit on ${otherChain} with $${secondCapital} so the wallet is active on a second chain ${p.name} supports.`,
          cost: `$${secondCapital} of capital and about $4 of gas`,
          time: '15 minutes to set up',
        },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a week, open the protocol's own points or rewards page from its official site and check the wallet shows the position; never connect the wallet to a link from a message or a search ad.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Plan the exit now: unwind in two halves a week apart so one failed withdrawal never strands the whole position, and write the wallet, the dates and every transaction hash in a farm log.`,
      cost: 'about $4 of gas to unwind',
      time: '10 minutes a week apart',
    },
  ];
  return plan.map((step) => {
    let line = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (line.length > 600) line = `${line.slice(0, 596)}...`;
    if (line.length < 20) line = `${line} Hold the position and check the protocol's own page.`;
    return line;
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const byMarketCap = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd;
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(byMarketCap)
    .slice(0, LIVE_ROWS)
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

/** A board row's compact form for data.js, farm plan included so the page renders it as written. */
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
    comp_ratio: row.model.comp_ratio,
    size_base: row.model.size_base,
    cat_factor: row.model.cat_factor,
    comp_members: row.model.comp_members,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    level_factor: row.model.level_factor,
    young: row.model.young,
    growth_reported: row.model.growth_reported,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit, level, backtest: back, factors } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_comp: globalComp(snapshot.protocols, model),
    size_fit: fit,
    backtest: back,
    level_factor: level,
    watchlist: snapshot.watchlist,
    comps: [...factors.entries()]
      .map(([name, info]) => ({ category: name, members: info.members, factor: info.factor, median_residual: info.median_residual }))
      .sort((x, y) => y.factor - x.factor),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

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
