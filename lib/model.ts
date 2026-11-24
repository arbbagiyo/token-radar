// Token Radar's model, radar-3: the snapshot in, a ranked board out.
//
// The board ranks every pre-token protocol the snapshot can honestly score: all 40 watchlist slugs
// plus every other pre-token protocol below the floor that is not a wrapped, staked or bridged
// product of a token that already trades, not an exchange, and not a versioned pool. Protocols whose
// token already trades are kept apart in the Live view, shown with their market cap, never mixed into
// the ranking.
//
// radar-3 fixes radar-2's weakest link: its category multiple. radar-2 took the median
// market-cap-to-TVL ratio of a category's live protocols and shrunk it toward the global median.
// That overstates big protocols twice over. First, the ratio itself falls hard with size: among the
// snapshot's 128 live protocols the median ratio is 0.42 below $50M of TVL, 0.17 at $50-200M, 0.06
// at $200M-1B and 0.03 above $1B, so a $2.7B protocol scored at a small-cap multiple is worth
// several times its plausible value. Second, thin categories decide the multiple on one member:
// Risk Curators had a single live member, so radar-2 scored every curator at that one protocol's
// ratio. radar-3 calibrates both effects from the live set itself, every run:
//
//   sizeBase = 10 ^ (a + b * log10(tvl_usd)), the least-squares line through the live protocols'
//              log10(market-cap/TVL) on log10(TVL), after winsorising each live ratio to
//              [0.005, 5] so one 400x outlier cannot tilt the line. On this snapshot the fit is
//              about log10 ratio = 2.52 - 0.42 * log10 TVL: a $10M protocol's base is ~0.41, a $1B
//              protocol's is ~0.06, a $3B protocol's ~0.04.
//   catFactor = the category's median residual from that line, shrunk toward 1 with a prior
//              weight of 6 (a one-member category keeps only a seventh of its residual) and
//              clamped to [0.25, 2.5]. A category with no live member gets factor 1.
//   comp     = clamp(sizeBase * catFactor, [0.01, 1.2]).
//   growth   = 1 + 0.30 * tanh(clamp(change_7d, -90, 900) / 100), bounded to [0.70, 1.30]; a
//              protocol whose 7-day change is unreported gets that factor times 0.97, because an
//              unreported number is not a flat week, it is missing data.
//   maturity = 0.65 + 0.35 * min(age_days, 1095) / 1095, times 0.90 when the protocol was first
//              listed under 90 days ago: a young listing with a huge TVL is usually a relisting
//              or a vault migration, not a durable record. An unlisted age scores 365 days.
//   breadth  = 1 + 0.02 * min(chains - 1, 4), at most 1.08: a protocol live on several chains has
//              more places its token could matter than a single-chain one.
//   implied  = round(tvl_usd * comp * growth * maturity * breadth), at least $1.
//
// Backtest, run by the model itself and shown on the dashboard: scoring the 128 live protocols
// with this same function and comparing with their actual market caps, the median implied value
// is within 3.2x of the real one and 63 of 128 land within 3x. radar-2's comp alone managed
// 3.9x and 53 of 128. The check is in-sample (the live set calibrates the multiples), and the
// dashboard says so; it is a sanity check on calibration, not a prediction.
//
// No protocol name is ever special-cased. The dashboard states the formula and recomputes every
// row's factors from the snapshot figures, so the page and board.json visibly agree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_prior: number;
  comp_floor: number;
  comp_cap: number;
  cat_factor_floor: number;
  cat_factor_cap: number;
  winsor_low: number;
  winsor_high: number;
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
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comp_ratio: number;
    size_base: number;
    cat_factor: number;
    comp_members: number;
    growth_pct: number | null;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    young: boolean;
    growth_reported: boolean;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comp_ratio: number;
  size_base: number;
  cat_factor: number;
  comp_members: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  young: boolean;
  growth_reported: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The least-squares line for log10(market-cap/TVL) on log10(TVL), fit on the live set. */
export interface SizeFit {
  intercept: number;
  slope: number;
  members: number;
}

/** The model's own backtest: the live protocols scored as if they were pre-token. */
export interface Backtest {
  members: number;
  median_factor_error: number;
  within_3x: number;
  within_10x: number;
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
  watchlist: string[];
  comps: { category: string; members: number; factor: number; median_residual: number }[];
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

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
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
  return (
    isPreToken(p) &&
    p.category !== null &&
    !DERIVATIVE_CATEGORIES.has(p.category) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A live protocol's market-cap-to-TVL ratio, winsorised: an extreme ratio is a data gap, not a price. */
function liveRatio(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return Math.min(model.winsor_high, Math.max(model.winsor_low, p.mcap_usd / p.tvl_usd));
}

/**
 * The size curve: least squares through the live protocols' log10 ratio on log10 TVL. The
 * slope is negative on any snapshot where big protocols trade at lower multiples than small
 * ones, which is what the market does; a slope at or above zero would mean the size effect is
 * absent, and the caller refuses the board rather than scoring on a broken fit.
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
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) * (p.x - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: round4(my - slope * mx), slope: round4(slope), members: n };
}

/** The size curve's base multiple for one TVL: what a protocol of that size typically trades at. */
export function sizeBaseFor(tvlUsd: number, fit: SizeFit): number {
  if (!(tvlUsd > 0)) return 0.2;
  return Math.pow(10, fit.intercept + fit.slope * Math.log10(tvlUsd));
}

/**
 * The category factors: each category's median residual from the size curve, shrunk toward 1
 * with the prior weight, then clamped. A one-member category keeps only 1/(1+prior) of its
 * residual, so a single odd live protocol cannot set its whole category's multiple.
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
    const med = median([...rs].sort((a, b) => a - b));
    if (med === null) continue;
    const shrunk = (rs.length * med) / (rs.length + model.shrink_prior);
    const factor = Math.min(model.cat_factor_cap, Math.max(model.cat_factor_floor, Math.pow(10, shrunk)));
    out.set(category, { factor: round4(factor), members: rs.length, median_residual: round4(med) });
  }
  return out;
}

/** The global median live ratio, for reference: the dashboard names it beside the size curve. */
export function globalComp(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): number {
  const ratios = protocols
    .map((p) => liveRatio(p, model))
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b);
  return round4(median(ratios) ?? 0.2);
}

/** A protocol's category multiple: its size base times its category's shrunk factor, clamped. */
export function compFor(
  p: SnapshotProtocol,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  model: ModelConstants = MODEL,
): { ratio: number; sizeBase: number; catFactor: number; members: number } {
  const sizeBase = sizeBaseFor(p.tvl_usd, fit);
  const hit = p.category === null ? undefined : factors.get(p.category);
  const catFactor = hit === undefined ? 1 : hit.factor;
  const members = hit === undefined ? 0 : hit.members;
  const ratio = Math.min(model.comp_cap, Math.max(model.comp_floor, sizeBase * catFactor));
  return { ratio: round4(ratio), sizeBase: round4(sizeBase), catFactor, members };
}

/**
 * The growth factor: tanh keeps a weekly spike bounded instead of letting it multiply the
 * value. An unreported 7-day change is discounted, not treated as a flat week.
 */
export function growthFactor(
  change7d: number | null,
  model: ModelConstants = MODEL,
): { pct: number | null; mult: number; reported: boolean } {
  if (change7d === null || !Number.isFinite(change7d)) {
    return { pct: null, mult: round4(model.unknown_growth_discount), reported: false };
  }
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, change7d));
  const mult = 1 + model.growth_weight * Math.tanh(pct / 100);
  return { pct, mult: round4(mult), reported: true };
}

/** The maturity factor: how long the protocol has run with no token, with a young-listing haircut. */
export function maturityFactor(
  age: number | null,
  model: ModelConstants = MODEL,
): { mult: number; young: boolean } {
  const days = age ?? model.unknown_age_days;
  const base =
    model.maturity_floor + (Math.min(Math.max(days, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const young = age !== null && age < model.young_age_days;
  return { mult: round4(base * (young ? model.young_discount : 1)), young };
}

/** The breadth factor: one extra chain at a time, capped, for how widely the protocol runs. */
export function breadthFactor(chains: string[], model: ModelConstants = MODEL): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.breadth_max_extra_chains);
  return round4(1 + model.breadth_step * extra);
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  model: ModelConstants = MODEL,
): {
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
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio: comp, sizeBase, catFactor, members: compMembers } = compFor(protocol, fit, factors, model);
  const { pct: growthPct, mult: growthMult, reported: growthReported } = growthFactor(protocol.change_7d, model);
  const { mult: maturityMult, young } = maturityFactor(age, model);
  const breadthMult = breadthFactor(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp * growthMult * maturityMult * breadthMult));
  return { implied, comp, sizeBase, catFactor, compMembers, growthPct, growthMult, growthReported, maturityMult, breadthMult, age, young };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The backtest: every live protocol scored with the same function as if it had no token,
 * against its real market cap. In-sample by construction — the live set calibrates the
 * multiples — so it is reported as a calibration check, never as out-of-sample proof.
 */
export function backtest(
  snapshot: Snapshot,
  fit: SizeFit,
  factors: Map<string, { factor: number; members: number; median_residual: number }>,
  model: ModelConstants = MODEL,
): Backtest {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  let within3 = 0;
  let within10 = 0;
  const errors: number[] = [];
  for (const p of live) {
    const v = impliedValue(p, snapshot.as_of, fit, factors, model);
    const ratio = v.implied / p.mcap_usd!;
    errors.push(Math.abs(Math.log10(ratio)));
    if (ratio > 1 / 3 && ratio < 3) within3++;
    if (ratio > 0.1 && ratio < 10) within10++;
  }
  const med = median([...errors].sort((a, b) => a - b)) ?? 0;
  return {
    members: live.length,
    median_factor_error: round4(Math.pow(10, med)),
    within_3x: within3,
    within_10x: within10,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitSizeCurve(snapshot.protocols, model);
  if (fit.slope >= 0) throw new SnapshotError('size curve slope is not negative: the live set shows no size effect to calibrate from');
  const factors = categoryFactors(snapshot.protocols, fit, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the board can honestly score, whatever its TVL.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, factors, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
      age_days: s.age,
      young: s.young,
      growth_reported: s.growthReported,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it accrues interest.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then close it after settlement.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares until the vault's epoch ends.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it through one payout.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Commit $${capital} of USDC to ${name}'s next sale on ${chain} and hold the allocation.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different action: a weekly touch that proves the wallet is active. */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $10 of USDC against your ${name} supply on ${chain}, repay it the same week, and leave the supply open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $10 through ${name}'s main pool on ${chain} and claim any fees the position earned.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close and reopen one small position on ${name} so the account shows a fresh trade each week.`;
  if (c.includes('prediction')) return `Settle one finished market on ${name} and place a fresh $5 position on the next one.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Rebalance $${capital} between two ${name} vaults on ${chain} once a month and keep the shares.`;
  if (c.includes('stable')) return `Swap $10 into and out of the stable asset on ${name} so the wallet shows two-way activity.`;
  if (c.includes('rwa')) return `Claim one payout from ${name} on ${chain} and redeposit it into the same asset.`;
  if (c.includes('insurance')) return `Renew or top up $${capital} of cover on ${name} before the policy lapses.`;
  if (c.includes('launchpad')) return `Vote or stake the allocation receipt on ${name} so the account stays active between sales.`;
  if (c.includes('basis')) return `Claim one funding payout from ${name} on ${chain} and leave the vault position open.`;
  return `Make one small swap or deposit of about $10 on ${name} so the wallet shows a fresh action each week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The seventh step is the exit: a farm with no unwind plan is a position you cannot leave.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const steps: { text: string; cost: string; time: string }[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    secondChain === null
      ? {
          text: weeklyActionFor(p, capital, chain),
          cost: 'about $2 of gas a week',
          time: '10 minutes a week',
        }
      : {
          text: `Repeat the same deposit on ${secondChain} with $${Math.max(25, Math.floor(capital / 2))} so the wallet is active on a second chain ${p.name} supports.`,
          cost: `$${Math.max(25, Math.floor(capital / 2))} of capital and about $4 of gas`,
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
  return steps.map((s) => {
    let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    if (out.length < 20) out = `${out} Hold the position and check the protocol's own page.`;
    return out;
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
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
    young: row.model.young,
    growth_reported: row.model.growth_reported,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fit = fitSizeCurve(snapshot.protocols, model);
  const factors = categoryFactors(snapshot.protocols, fit, model);
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
    backtest: backtest(snapshot, fit, factors, model),
    watchlist: snapshot.watchlist,
    comps: [...factors.entries()]
      .map(([category, v]) => ({ category, members: v.members, factor: v.factor, median_residual: v.median_residual }))
      .sort((a, b) => b.factor - a.factor),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
