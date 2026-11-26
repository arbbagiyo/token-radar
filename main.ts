// Token Radar, radar-6: the sealed snapshot in, a ranked board and a dashboard out.
//
// Node 22, standard library only, no network. It reads /input/snapshot.json (or --input
// <snapshot.json|directory>), scores every rankable pre-token protocol with the model in
// lib/model.ts — a size curve fit on the stand-alone traded comps, every extra term tested
// held-out (leave-one-out and walk-forward, five-fold reported) and kept only when both
// selection tests improve, forward token odds from a Weibull time-to-record model on the
// dated peers, ranges from the held-out residuals, and a costed farm verdict on every row —
// writes the ranked board to /output/board.json and the dashboard's data to /output/data.js,
// copies dashboard/ and screenshots/ to /output, and writes /output/dossier.json with the
// vendored make.fun library. Two runs write the same bytes: the model is a pure function of
// the snapshot, every sort has a slug tie-break, and the bootstrap uses a fixed seed. The run
// prints the model's own held-out evidence, so a bad calibration is visible in the log
// instead of hiding in the board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
const dataText = dataScript(radar);
writeFileSync(join(out, 'data.js'), dataText);

// The dashboard must render exactly what board.json carries: read data.js back and refuse when
// a row's slug, implied value or farm plan differs from the board it was written from, or when
// the checksum the page recomputes would not match the one main.ts wrote.
const readBack = JSON.parse(readFileSync(join(out, 'data.js'), 'utf8').replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));
if (
  !Array.isArray(readBack.rows) ||
  readBack.rows.length !== board.length ||
  readBack.rows.some(
    (r: { slug: string; implied_value_usd: number; farm_steps: string[] }, i: number) =>
      r.slug !== board[i]!.slug ||
      r.implied_value_usd !== board[i]!.implied_value_usd ||
      JSON.stringify(r.farm_steps) !== JSON.stringify(board[i]!.farm_steps),
  )
) {
  process.stderr.write('token radar: data.js does not match board.json: refusing to write a dossier from mismatched data\n');
  process.exit(1);
}
if (readBack.checksum !== radar.checksum) {
  process.stderr.write('token radar: data.js checksum does not match board.json: refusing to write a dossier from mismatched data\n');
  process.exit(1);
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const top = board[0]!;
const bottom = board[board.length - 1]!;
const fit = radar.size_fit;
const value = radar.value;
const odds = radar.odds;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.offlist_size} off-list, ${radar.comp_size} comps)\n` +
    `token radar: size curve log10 ratio = ${fit.intercept} + ${fit.slope} x log10 TVL, fit on ${fit.members} stand-alone comps\n` +
    `token radar: value terms kept: ${value.kept_terms.length === 0 ? 'none — size curve only' : value.kept_terms.join(', ')}; LOO miss x${value.final_loo_miss} (flat x${value.flat_loo_miss}), walk-forward x${value.final_walk_forward_miss} (flat x${value.flat_walk_forward_miss}), five-fold x${value.final_five_fold_miss}\n` +
    `token radar: level factor x${value.level_factor} (${value.level_applied ? 'applied, LOO improved' : 'not applied'}; median signed log error ${value.level_median_signed_log_error})\n` +
    `token radar: odds terms kept: ${odds.kept_terms.join(', ') || 'none (age only)'}; Weibull shape ${odds.weibull_shape}, scale ${odds.weibull_scale_years}y; Brier ten-fold ${odds.brier_ten_fold} vs base ${odds.base_brier_ten_fold}, walk-forward ${odds.brier_walk_forward} vs base ${odds.base_brier_walk_forward}\n` +
    `token radar: odds peer set ${odds.peer_set}: ${odds.peer_set_note}\n` +
    `token radar: ranges P25-P75 cover ${Math.round(value.coverage_p25_p75_loo * 100)}% LOO / ${Math.round(value.coverage_p25_p75_walk_forward * 100)}% walk-forward (stated 50%); P10-P90 cover ${Math.round(value.coverage_p10_p90_loo * 100)}% / ${Math.round(value.coverage_p10_p90_walk_forward * 100)}% (stated 80%)\n` +
    `token radar: verdicts FARM ${radar.verdict_counts.FARM}, THIN ${radar.verdict_counts.THIN}, SKIP ${radar.verdict_counts.SKIP}; checksum ${radar.checksum}\n` +
    `token radar: rank 1 ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')}, rank ${board.length} ${bottom.slug} at $${bottom.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
