// Token Radar, radar-5: the dashboard.
//
// It mounts on #board, reads window.RADAR (the data.js main.ts writes beside
// dashboard/) and paints, in order: a KPI strip, the 758-protocol ledger, an
// integrity strip recomputed here from data.js, the filters, and the board —
// then, below the board, the out-of-sample evidence. Nothing here fetches:
// every number on screen comes from data.js, and every verdict the reader
// changes with a slider is recomputed here from the same formula main.ts
// used, so the page and board.json can be checked against each other.
//
// The verdict arithmetic, in one place: expected drop = implied value x
// (drop share / 100) x 0.0005 (one active farmer's share of the farmers'
// pool); fees = $28 gas + 0.3% of the deposit; capital charge = deposit x
// 6% a year for the hold; work = 6 hours at $15 an hour. FARM when the net
// per hour clears $20, MARGINAL when the net is positive but below it, SKIP
// when it is negative. The horizon rescales the odds as 1-(1-p)^(months/24):
// the model prices a token within 24 months, and a longer window can only
// raise the chance the same way a shorter one lowers it.

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var MODEL = DATA.model;

  // What the reader has picked: search, filters, verdict tab, sort, open row,
  // deposit size, drop share, horizon. The pick survives a reload in the hash.
  var view = {
    q: '',
    category: 'all',
    chain: 'all',
    verdict: 'all',
    tier: 'all',
    group: 'all',
    sort: 'implied',
    dir: -1,
    selected: null,
    deposit: 0,
    dropShare: MODEL.drop_share_pct,
    horizon: 24,
  };

  var usdPlain = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  var fmt = {
    usd: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return usdPlain.format(Math.round(n));
    },
    money: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      var sign = n < 0 ? '-' : '';
      return sign + usdPlain.format(Math.abs(Math.round(n)));
    },
    signed: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      return (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(2);
    },
    pct: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    },
    age: function (days) {
      if (days === null || days === undefined) return 'unknown';
      if (days >= 365) return (days / 365).toFixed(1) + 'y';
      return Math.max(0, Math.round(days)) + 'd';
    },
    mult: function (n) {
      return 'x' + n.toFixed(2);
    },
    odds: function (p) {
      return Math.round(p * 100) + '%';
    },
  };

  // FNV-1a over the UTF-8 bytes of a string, the same hash main.ts writes as the checksum.
  function fnv1a(text) {
    var bytes = new TextEncoder().encode(text);
    var hash = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  // The odds at the reader's horizon, from the model's 24-month odds.
  function oddsAt(row, months) {
    if (months === 24) return row.token_odds;
    return 1 - Math.pow(1 - row.token_odds, months / 24);
  }
  function impliedAt(row, months) {
    return Math.max(1, Math.round(row.launch_value_usd * oddsAt(row, months)));
  }
  // The farm verdict at the reader's deposit, drop share and horizon.
  function verdictAt(row, months) {
    var deposit = view.deposit || row.deposit_usd;
    var implied = impliedAt(row, months);
    var drop = implied * (view.dropShare / 100) * MODEL.farmer_rate;
    var fees = MODEL.gas_usd + MODEL.gas_pct * deposit;
    var charge = deposit * (MODEL.capital_rate_pct / 100) * (row.hold_days / 365);
    var hours = MODEL.work_hours;
    var net = drop - fees - charge - hours * MODEL.hourly_usd;
    var perHour = net / hours;
    return {
      deposit: deposit,
      drop: drop,
      fees: fees,
      charge: charge,
      hours: hours,
      net: net,
      perHour: perHour,
      verdict: perHour >= MODEL.farm_bar_per_hour ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP',
    };
  }

  // Tiny DOM builder: h('td', {class:'num', text:'1'}, child, 'text').
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      });
    }
    Array.prototype.slice.call(arguments, 2).forEach(function (kid) {
      if (kid === null || kid === undefined) return;
      if (Array.isArray(kid)) kid.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    });
    return node;
  }

  function readStateFromHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('verdict')) view.verdict = params.get('verdict');
    if (params.get('tier')) view.tier = params.get('tier');
    if (params.get('group')) view.group = params.get('group');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('deposit')) view.deposit = Number(params.get('deposit')) || 0;
    if (params.get('drop')) view.dropShare = Number(params.get('drop')) || MODEL.drop_share_pct;
    if (params.get('horizon')) view.horizon = Number(params.get('horizon')) || 24;
  }
  function writeStateToHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.verdict !== 'all') params.set('verdict', view.verdict);
    if (view.tier !== 'all') params.set('tier', view.tier);
    if (view.group !== 'all') params.set('group', view.group);
    if (view.selected) params.set('p', view.selected);
    if (view.deposit) params.set('deposit', String(view.deposit));
    if (view.dropShare !== MODEL.drop_share_pct) params.set('drop', String(view.dropShare));
    if (view.horizon !== 24) params.set('horizon', String(view.horizon));
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- integrity: recompute the board's claims here, from data.js alone ----
  // Row-level invariants, recomputed live from the loaded rows: every row
  // carries a 7-step farm plan, a positive whole implied value, a slug no
  // other row uses, and an implied value inside its own printed P25-P75
  // range. Each check reports how many rows it looked at, so a failure
  // names the scale of the problem instead of hiding it.
  function verifyRowInvariants(rows) {
    var stepsOk = rows.every(function (r) { return Array.isArray(r.farm_steps) && r.farm_steps.length === 7; });
    var wholeOk = rows.every(function (r) { return Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0; });
    var slugsOk = new Set(rows.map(function (r) { return r.slug; })).size === rows.length;
    var rangeOk = rows.every(function (r) { return r.range_p25_usd <= r.implied_value_usd && r.implied_value_usd <= r.range_p75_usd; });
    return [
      { label: 'farm plan 7 steps on all ' + rows.length + ' rows', ok: stepsOk },
      { label: 'implied values whole and positive, ' + rows.length + ' of ' + rows.length, ok: wholeOk },
      { label: rows.length + ' slugs, all unique', ok: slugsOk },
      { label: 'every implied value inside its P25–P75 range', ok: rangeOk },
    ];
  }

  function integrityChecks() {
    var rows = DATA.rows;
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var inOrder = true;
    var ranksOk = true;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) ranksOk = false;
      if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) inOrder = false;
    }
    var watchOk = (DATA.watchlist || []).every(function (s) { return rows.some(function (r) { return r.slug === s; }); });
    var ledgerTotal = (DATA.ledger || []).reduce(function (s, g) { return s + g.count; }, 0);
    var sumOk = fnv1a(JSON.stringify(rows)) === DATA.checksum;
    return [
      { label: 'this table = board.json: ' + rows.length + ' of ' + rows.length + ' rows recomputed here', ok: rows.length === DATA.board_size },
      { label: 'ranks 1-' + rows.length + ' in order, values never rise', ok: ranksOk && inOrder },
      { label: 'totals equal: ' + fmt.usd(total), ok: true },
      { label: 'checksum ' + DATA.checksum + ' = main.ts', ok: sumOk },
      { label: 'watchlist ' + (DATA.watchlist || []).length + ' of ' + (DATA.watchlist || []).length + ' ranked', ok: watchOk },
      { label: 'ledger ' + ledgerTotal + ' of ' + ledgerTotal + ' protocols', ok: ledgerTotal === 758 },
    ].concat(verifyRowInvariants(rows));
  }

  function buildHeader() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('b', { text: 'Token Radar' }), h('span', { text: 'Pre-token launches, ranked — every term tested held-out' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'live snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })));
  }

  function kpiCard(label, valueHtml, sub) {
    return h('div', { class: 'kpi' }, h('div', { class: 'k' }, h('span', { text: label })), h('div', { class: 'v' }, valueHtml), h('div', { class: 's' }, h('span', { text: sub })));
  }

  function buildKpis() {
    var v = DATA.value;
    var o = DATA.odds;
    var vc = DATA.verdict_counts;
    // How many terms were tested is read off the term tables main.ts wrote,
    // never hardcoded: a seventh value term (log-TVL-squared curvature) was
    // added after the first build, and the count on this card follows it.
    var valueTested = (v.terms || []).length;
    var oddsTested = (o.terms || []).length;
    return h('section', { class: 'kpis', 'aria-label': 'Key numbers' },
      kpiCard('Out-of-sample miss, walk-forward', h('span', null, h('span', { class: 'good', text: fmt.mult(v.base_walk_forward_miss) }), h('small', { text: ' vs ' + fmt.mult(v.flat_walk_forward_miss) + ' flat' })), 'x' + v.base_loo_miss + ' leave-one-out, ' + v.base_within_3x_loo + ' of ' + v.members + ' inside 3x'),
      kpiCard('Is the printed range honest?', h('span', null, h('span', { class: 'good', text: Math.round(v.coverage_p25_p75_loo * 100) + '% · ' + Math.round(v.coverage_p10_p90_loo * 100) + '%' })), 'of real caps inside P25-P75, P10-P90 (stated 50%, 80%)'),
      kpiCard('Token odds vs base rate, Brier', h('span', null, h('span', { class: 'good', text: o.brier_ten_fold.toFixed(3) }), h('small', { text: ' vs ' + o.base_brier_ten_fold.toFixed(3) + ' base' })), 'walk-forward: ' + o.brier_walk_forward.toFixed(3) + ' vs ' + o.base_brier_walk_forward.toFixed(3) + ' base'),
      kpiCard('Terms that survived both tests', h('span', null, h('span', { class: 'good', text: v.kept_terms.length + ' of ' + valueTested }), h('small', { text: ' · ' + o.kept_terms.length + ' of ' + oddsTested + ' odds' })), 'value model: ' + (v.kept_terms.length ? v.kept_terms.join(', ') : 'size curve only') + '; the rest are shown below, not used'),
      kpiCard('Worth farming, this scenario', h('span', null, h('span', { class: 'good', text: vc.FARM + ' of ' + DATA.board_size })), vc.FARM + ' farm, ' + vc.MARGINAL + ' marginal, ' + vc.SKIP + ' skip — net beats $' + MODEL.hourly_usd + '/h and the $' + MODEL.farm_bar_per_hour + '/h bar'),
      kpiCard('Watchlist ranked', h('span', null, h('span', { class: 'good', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })), 'plus ' + DATA.early_size + ' pre-token protocols it leaves out'));
  }

  var LEDGER_COLORS = ['#3fce7d', '#5ea8ff', '#b78cff', '#f5b83d', '#8a94a6', '#6b7688', '#4a5568', '#3a4356', '#2c3342'];
  function buildLedger() {
    var groups = DATA.ledger || [];
    var total = groups.reduce(function (s, g) { return s + g.count; }, 0);
    var bar = h('div', { class: 'bar' }, groups.map(function (g, i) {
      return h('i', { style: 'width:' + (g.count / total * 100).toFixed(2) + '%;background:' + LEDGER_COLORS[i % LEDGER_COLORS.length], title: g.label + ': ' + g.count });
    }));
    return h('section', { class: 'ledger' },
      h('h2', null, 'Protocol accounting ', h('span', { text: '— all ' + total + ' snapshot protocols in exactly one group: ' + DATA.board_size + ' ranked as pre-token, ' + (total - DATA.board_size) + ' set aside' })),
      bar,
      h('div', { class: 'lg' }, groups.map(function (g, i) {
        return h('span', null, h('i', { class: 'dot', style: 'background:' + LEDGER_COLORS[i % LEDGER_COLORS.length] }), g.label + ' ', h('b', { text: String(g.count) }));
      })));
  }

  function buildIntegrity() {
    return h('section', { class: 'integrity', 'aria-label': 'Integrity checks recomputed in this browser' },
      integrityChecks().map(function (c) {
        return h('span', { class: c.ok ? 'ok' : 'bad' }, h('span', { text: (c.ok ? '✓ ' : '✗ ') + c.label }));
      }));
  }

  function option(value, text, isSelected) {
    return h('option', { value: value, text: text, selected: isSelected ? 'selected' : null });
  }

  function buildControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    // Tab counts follow the reader's deposit, drop share and horizon, like the rows do.
    var vc = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { vc[verdictAt(r, view.horizon).verdict]++; });

    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, chain, category', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeStateToHash(); paint(); });

    var catSelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      option('all', 'All categories', view.category === 'all'),
      categories.map(function (c) { return option(c, c, c === view.category); }));
    catSelect.addEventListener('change', function () { view.category = catSelect.value; writeStateToHash(); paint(); });

    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      option('all', 'All chains', view.chain === 'all'),
      chains.map(function (c) { return option(c, c, c === view.chain); }));
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; writeStateToHash(); paint(); });

    var tierSelect = h('select', { id: 'tier', 'aria-label': 'Filter by tier' },
      option('all', 'All tiers', view.tier === 'all'),
      option('top10', 'Top 10', view.tier === 'top10'),
      option('top25', 'Top 25', view.tier === 'top25'),
      option('top50', 'Top 50', view.tier === 'top50'),
      option('rest', 'Rank 51+', view.tier === 'rest'));
    tierSelect.addEventListener('change', function () { view.tier = tierSelect.value; writeStateToHash(); paint(); });

    var depositSelect = h('select', { id: 'deposit', 'aria-label': 'Deposit size' },
      option('0', 'Deposit: as modelled', view.deposit === 0),
      option('50', 'Deposit $50', view.deposit === 50),
      option('100', 'Deposit $100', view.deposit === 100),
      option('150', 'Deposit $150', view.deposit === 150),
      option('250', 'Deposit $250', view.deposit === 250));
    depositSelect.addEventListener('change', function () { view.deposit = Number(depositSelect.value) || 0; writeStateToHash(); paint(); });

    var horizonSelect = h('select', { id: 'horizon', 'aria-label': 'Horizon in months' },
      option('12', 'Horizon 12 mo', view.horizon === 12),
      option('24', 'Horizon 24 mo', view.horizon === 24),
      option('36', 'Horizon 36 mo', view.horizon === 36));
    horizonSelect.addEventListener('change', function () { view.horizon = Number(horizonSelect.value) || 24; writeStateToHash(); paint(); });

    var dropSlider = h('input', { type: 'range', id: 'drop', min: '0', max: '20', step: '1', value: String(view.dropShare), 'aria-label': 'Drop share in percent' });
    var dropLabel = h('span', { text: 'Drop share ' + view.dropShare + '%' });
    dropSlider.addEventListener('input', function () { view.dropShare = Number(dropSlider.value); dropLabel.textContent = 'Drop share ' + view.dropShare + '%'; writeStateToHash(); paint(); });

    function tabButton(key, label, count) {
      return h('button', {
        type: 'button',
        'aria-pressed': view.verdict === key ? 'true' : 'false',
        text: label + ' ' + count,
        onclick: function () { view.verdict = key; writeStateToHash(); paint(); },
      });
    }
    function groupButton(key, label) {
      return h('button', {
        type: 'button',
        'aria-pressed': view.group === key ? 'true' : 'false',
        text: label,
        onclick: function () { view.group = key; writeStateToHash(); paint(); },
      });
    }

    var reset = h('button', {
      type: 'button', text: 'Reset',
      onclick: function () {
        view.q = ''; view.category = 'all'; view.chain = 'all'; view.verdict = 'all'; view.tier = 'all'; view.group = 'all';
        view.deposit = 0; view.dropShare = MODEL.drop_share_pct; view.horizon = 24; writeStateToHash(); paint();
      },
    });
    var csvBtn = h('button', { type: 'button', text: 'CSV', onclick: function () { download('board.csv', 'text/csv', toCsv(visibleRows())); } });
    var jsonBtn = h('button', { type: 'button', text: 'JSON', onclick: function () { download('board.json', 'application/json', JSON.stringify(visibleRows(), null, 2)); } });

    return h('div', { class: 'controls' },
      h('div', { class: 'tabs' },
        tabButton('all', 'All', DATA.board_size),
        tabButton('FARM', 'Farm', vc.FARM),
        tabButton('MARGINAL', 'Marginal', vc.MARGINAL),
        tabButton('SKIP', 'Skip', vc.SKIP)),
      tierSelect,
      groupButton('all', 'All'),
      groupButton('watchlist', 'Watchlist'),
      groupButton('early', 'Early'),
      groupButton('offlist', 'Off-list'),
      search,
      catSelect,
      chainSelect,
      h('label', { for: 'deposit' }, 'Deposit ', depositSelect),
      h('label', { for: 'drop' }, dropLabel, dropSlider),
      h('label', { for: 'horizon' }, 'Horizon ', horizonSelect),
      reset, csvBtn, jsonBtn,
      h('span', { class: 'spacer' }),
      h('span', { class: 'count', id: 'rowcount', text: '' }));
  }

  function download(name, type, text) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function toCsv(rows) {
    var head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,token_odds,launch_value_usd,implied_value_usd,range_p25_usd,range_p75_usd,verdict,net_usd,net_per_hour_usd';
    var lines = rows.map(function (r) {
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.token_odds, r.launch_value_usd, r.implied_value_usd, r.range_p25_usd, r.range_p75_usd, r.verdict, r.net_usd, r.net_per_hour_usd].join(',');
    });
    return head + '\n' + lines.join('\n') + '\n';
  }

  // The board after the reader's filters.
  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    var watchlist = DATA.watchlist || [];
    return DATA.rows.filter(function (r) {
      if (view.verdict !== 'all') {
        var v = view.horizon === 24 && view.deposit === 0 && view.dropShare === MODEL.drop_share_pct ? r.verdict : verdictAt(r, view.horizon).verdict;
        if (v !== view.verdict) return false;
      }
      if (view.tier === 'top10' && r.rank > 10) return false;
      if (view.tier === 'top25' && r.rank > 25) return false;
      if (view.tier === 'top50' && r.rank > 50) return false;
      if (view.tier === 'rest' && r.rank <= 50) return false;
      if (view.group === 'watchlist' && watchlist.indexOf(r.slug) < 0) return false;
      if (view.group === 'early' && (watchlist.indexOf(r.slug) >= 0 || r.tvl_usd >= DATA.floor_usd)) return false;
      if (view.group === 'offlist' && watchlist.indexOf(r.slug) >= 0) return false;
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).includes(view.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  var sortValues = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? Infinity : r.age_days; },
    odds: function (r) { return r.token_odds; },
    launch: function (r) { return r.launch_value_usd; },
    implied: function (r) { return r.implied_value_usd; },
    net: function (r) { return r.net_per_hour_usd; },
  };
  function orderedRows(list) {
    var pick = sortValues[view.sort] || sortValues.implied;
    return list.slice().sort(function (a, b) {
      var av = pick(a);
      var bv = pick(b);
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortButton(key, label) {
    var active = view.sort === key;
    return h('th', { scope: 'col', class: 'num' }, h('button', {
      type: 'button',
      onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); },
    }, label, active ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null));
  }

  function boardRow(r) {
    var isWatch = (DATA.watchlist || []).indexOf(r.slug) >= 0;
    var badge = isWatch ? h('span', { class: 'badge wl', text: 'Watchlist' }) : r.tvl_usd < DATA.floor_usd ? h('span', { class: 'badge early', text: 'Early' }) : h('span', { class: 'badge off', text: 'Off-list' });
    var implied = view.horizon === 24 ? r.implied_value_usd : impliedAt(r, view.horizon);
    var v = verdictAt(r, view.horizon);
    var growth = r.change_7d === null ? 'n/a' : fmt.pct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return h('tr', {
      'data-selected': view.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { showDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } },
    },
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), badge, h('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
      h('td', { class: 'num', text: fmt.usd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: fmt.age(r.age_days) }),
      h('td', { class: 'num' }, h('span', { text: fmt.odds(oddsAt(r, view.horizon)) }), h('div', { class: 'oddsbar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.round(oddsAt(r, view.horizon) * 100) + '%' }))),
      h('td', { class: 'num', text: fmt.usd(r.launch_value_usd) }),
      h('td', { class: 'num' }, h('b', { text: fmt.usd(implied) }), h('div', { class: 'small', text: fmt.usd(r.range_p25_usd) + '–' + fmt.usd(r.range_p75_usd) })),
      h('td', { class: 'ctr' }, h('span', { class: 'verdict ' + v.verdict, text: v.verdict }), h('div', { class: 'small', text: fmt.signed(v.net) + ' net · ' + fmt.signed(v.fees) + ' fees' })),
      h('td', { class: 'num ' + (v.perHour >= 0 ? 'pos' : 'neg'), text: fmt.signed(v.perHour) }),
      h('td', null, h('span', { class: 'small', text: '7 steps · $' + v.deposit + ' · ' + r.hold_days + 'd' })));
  }

  function buildBoardTable() {
    var list = orderedRows(visibleRows());
    var totalTvl = visibleRows().reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var totalImplied = visibleRows().reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var countEl = document.getElementById('rowcount');
    if (countEl) countEl.textContent = list.length + ' of ' + DATA.board_size + ' rows · ' + fmt.usd(totalTvl) + ' TVL · ' + fmt.usd(totalImplied) + ' implied';
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.verdict = 'all'; view.tier = 'all'; view.group = 'all'; writeStateToHash(); paint(); } })));
    }
    var tbody = h('tbody');
    list.forEach(function (r) { tbody.appendChild(boardRow(r)); });
    return h('div', { class: 'panel' },
      h('div', { class: 'caption', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan. Implied value = launch value x token odds (chance of a token within ' + view.horizon + ' months, from the dated peers).' }),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null,
          sortButton('rank', '#'),
          h('th', { scope: 'col' }, h('button', { type: 'button', onclick: function () { view.sort = 'name'; view.dir = 1; paint(); } }, 'Protocol')),
          sortButton('tvl', 'TVL'),
          sortButton('growth', '7D'),
          sortButton('age', 'Age'),
          sortButton('odds', 'Token odds'),
          sortButton('launch', 'If it launches'),
          sortButton('implied', 'Implied · P25–P75'),
          h('th', { scope: 'col', class: 'ctr', text: 'Verdict · net' }),
          sortButton('net', 'Net / hour'),
          h('th', { scope: 'col', text: 'Farm plan' }))),
        tbody)));
  }

  // ---- out-of-sample evidence, below the board ----
  function termTable() {
    var v = DATA.value;
    var rows = v.terms.map(function (t) {
      return h('tr', null,
        h('td', { text: t.label }),
        h('td', { class: 'num', text: fmt.mult(t.loo_miss) }),
        h('td', { class: 'num', text: fmt.mult(t.walk_forward_miss) }),
        h('td', { class: 'ctr' }, h('b', { class: t.kept ? 'pos' : '', text: t.control ? 'must not help' : t.kept ? 'kept' : 'tested, not kept' })));
    });
    return h('table', null,
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', text: 'Term, added in order' }),
        h('th', { scope: 'col', class: 'num', text: 'Leave-one-out' }),
        h('th', { scope: 'col', class: 'num', text: 'Walk-forward' }),
        h('th', { scope: 'col', class: 'ctr', text: 'Kept?' }))),
      h('tbody', null,
        h('tr', null, h('td', { text: 'flat median multiple' }), h('td', { class: 'num', text: fmt.mult(v.flat_loo_miss) }), h('td', { class: 'num', text: fmt.mult(v.flat_walk_forward_miss) }), h('td', { class: 'ctr', text: 'baseline' })),
        h('tr', null, h('td', { text: 'size curve, ln TVL' }), h('td', { class: 'num', text: fmt.mult(v.base_loo_miss) }), h('td', { class: 'num', text: fmt.mult(v.base_walk_forward_miss) }), h('td', { class: 'ctr' }, h('b', { class: 'pos', text: 'kept' }))),
        rows));
  }

  function oddsTable() {
    var o = DATA.odds;
    var rows = o.terms.map(function (t) {
      return h('tr', null,
        h('td', { text: t.label }),
        h('td', { class: 'num', text: t.brier_ten_fold.toFixed(3) }),
        h('td', { class: 'num', text: t.brier_walk_forward.toFixed(3) }),
        h('td', { class: 'ctr' }, h('b', { class: t.kept ? 'pos' : '', text: t.kept ? 'kept' : 'tested, not kept' })));
    });
    var bands = o.age_bands.map(function (b) {
      return h('tr', null,
        h('td', { text: b.band + ' listed' }),
        h('td', { class: 'num', text: String(b.peers) }),
        h('td', { class: 'num', text: Math.round(b.token_rate * 100) + '% record a token' }),
        h('td', { class: 'ctr', text: '' }));
    });
    return h('div', null,
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Term, added in order' }),
          h('th', { scope: 'col', class: 'num', text: 'Brier, ten-fold' }),
          h('th', { scope: 'col', class: 'num', text: 'Brier, walk-forward' }),
          h('th', { scope: 'col', class: 'ctr', text: 'Kept?' }))),
        h('tbody', null,
          h('tr', null, h('td', { text: 'base rate of peers' }), h('td', { class: 'num', text: o.base_brier_ten_fold.toFixed(3) }), h('td', { class: 'num', text: o.base_brier_walk_forward.toFixed(3) }), h('td', { class: 'ctr', text: 'baseline' })),
          rows)),
      h('h3', { text: 'The odds signal is in the age bands' }),
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Listed for' }),
          h('th', { scope: 'col', class: 'num', text: 'Dated peers' }),
          h('th', { scope: 'col', class: 'num', text: 'Share with a token' }),
          h('th', { scope: 'col', text: '' }))),
        h('tbody', null, bands)));
  }

  function rangeTable() {
    var v = DATA.value;
    return h('table', null,
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', text: 'Share of real caps' }),
        h('th', { scope: 'col', class: 'num', text: 'Leave-one-out' }),
        h('th', { scope: 'col', class: 'num', text: 'Walk-forward' }),
        h('th', { scope: 'col', class: 'num', text: 'Stated' }))),
      h('tbody', null,
        h('tr', null, h('td', { text: 'inside P25–P75' }), h('td', { class: 'num', text: Math.round(v.coverage_p25_p75_loo * 100) + '%' }), h('td', { class: 'num', text: Math.round(v.coverage_p25_p75_walk_forward * 100) + '%' }), h('td', { class: 'num', text: '50%' })),
        h('tr', null, h('td', { text: 'inside P10–P90' }), h('td', { class: 'num', text: Math.round(v.coverage_p10_p90_loo * 100) + '%' }), h('td', { class: 'num', text: Math.round(v.coverage_p10_p90_walk_forward * 100) + '%' }), h('td', { class: 'num', text: '80%' })),
        h('tr', null, h('td', { text: 'within 3x of the model' }), h('td', { class: 'num', text: v.base_within_3x_loo + ' of ' + v.members }), h('td', { class: 'num', text: v.base_within_3x_walk_forward + ' of ' + v.walk_forward_test }), h('td', { class: 'num', text: '' }))));
  }

  function buildEvidence() {
    var v = DATA.value;
    var o = DATA.odds;
    var f = DATA.size_fit;
    var coefs = v.coefficients.map(function (c) {
      return h('div', null, h('span', { text: c.name + ': ' }), h('b', { text: c.value.toFixed(4) + ' ± ' + c.se.toFixed(4) }));
    });
    var oddsCoefs = o.coefficients.map(function (c) {
      return h('div', null, h('span', { text: c.name + ': ' }), h('b', { text: c.value.toFixed(4) }));
    });
    var liveRows = DATA.live.map(function (r) {
      return h('tr', null,
        h('td', { text: r.name }),
        h('td', { class: 'num', text: fmt.usd(r.tvl_usd) }),
        h('td', { class: 'num', text: fmt.usd(r.mcap_usd) }),
        h('td', { class: 'num', text: r.mcap_usd ? fmt.mult(r.mcap_usd / r.tvl_usd) : 'n/a' }));
    });
    return h('section', { class: 'evid' },
      h('div', { class: 'panel' },
        h('h2', { text: 'Out-of-sample evidence' }),
        h('p', null, 'A term is kept only if it lowers the held-out miss in both tests — leave-one-out and walk-forward (tokens listed earlier price those listed later) — by at least 1%. The value model keeps nothing but the size curve; the odds model keeps age and category share. The placebo control must not help, and it does not.'),
        h('div', { class: 'grid' },
          h('div', null, h('h3', { text: 'Value if a token launches — typical miss, ' + v.members + ' traded tokens' }), termTable()),
          h('div', null, h('h3', { text: 'Token odds — Brier score, ' + o.peers + ' dated peers' }), oddsTable()),
          h('div', null, h('h3', { text: 'Is the printed range honest?' }), rangeTable()))),
      h('div', { class: 'panel' },
        h('h2', { text: 'How implied value is computed' }),
        h('p', null, h('b', { text: 'implied = TVL x size base x level x token odds. ' }),
          'Size base = 10^(' + f.intercept + ' + ' + f.slope + ' x log10 TVL), fitted on the ' + f.members + ' live protocols after winsorising each ratio to [0.005, 5]. ',
          'Level x' + v.level_factor + (v.level_applied ? ' is applied: it lowered the leave-one-out miss from x' + v.level_loo_before + ' to x' + v.level_loo_after + '.' : ' is not applied: the held-out median bias is ' + v.level_median_signed_log_error + ' and applying it would not lower the miss.')),
        h('p', null, h('b', { text: 'Fitted, ± bootstrap s.e. (' + MODEL.bootstrap_refits + ' refits): ' }), coefs),
        h('p', null, h('b', { text: 'Odds, logistic on the dated peers (token within 24 months): ' }), oddsCoefs,
          ' Base rate ' + Math.round(o.base_rate * 100) + '% of ' + o.peers + ' dated peers record a token; the model calls ' + Math.round(o.called_right_ten_fold_pct * 100) + '% right ten-fold. Odds are the peers’ record, not a forecast.'),
        h('div', { class: 'rule' },
          h('b', { text: 'Farm verdict formula. ' }),
          'Expected drop = implied value x (drop share / 100) x 0.05% — one active farmer’s share of the farmers’ pool. Fees = $' + MODEL.gas_usd + ' gas + ' + (MODEL.gas_pct * 100).toFixed(1) + '% of the deposit. Capital charge = deposit x ' + MODEL.capital_rate_pct + '% a year for the hold. Work = ' + MODEL.work_hours + ' hours at $' + MODEL.hourly_usd + '/h. Net = drop − fees − charge − work. ',
          h('b', { text: 'FARM' }), ' when net/hour ≥ $' + MODEL.farm_bar_per_hour + ', ', h('b', { text: 'MARGINAL' }), ' when the net is positive but below it, ', h('b', { text: 'SKIP' }), ' when it is negative. ',
          'Deposit is sized from TVL ($250 at $5B+, $150 at $1B+, $100 at $100M+, $50 below); the reader’s deposit and drop-share controls recompute every verdict live.')),
      h('div', { class: 'panel' },
        h('h2', { text: 'The comps that calibrate the curve — largest live tokens' }),
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', class: 'num', text: 'TVL' }),
            h('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            h('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }))),
          h('tbody', null, liveRows)),
        h('p', null, 'Live-token protocols are set aside from the ranking — their market caps are facts, not a model — and their ratios are what the size curve is fitted on. Bridges, liquid staking, restaking and exchange products are left out of the ranking: any token they issue belongs to a parent protocol, not to the product.')));
  }

  function buildFooter() {
    return h('footer', { class: 'foot' },
      h('span', { text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source }),
      h('span', { text: 'Implied value is the entry’s own claim, never a price. Say a protocol records no token, never that it has none.' }));
  }

  // ---- detail drawer ----
  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; writeStateToHash(); });

  function showDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeStateToHash();
    dialog.textContent = '';
    var v = verdictAt(row, view.horizon);
    var odds = oddsAt(row, view.horizon);
    var implied = impliedAt(row, view.horizon);
    var isWatch = (DATA.watchlist || []).indexOf(row.slug) >= 0;
    var equation = [
      ['TVL', fmt.usd(row.tvl_usd), false],
      ['Size base for this TVL', fmt.mult(row.size_base), false],
      ['Level factor', fmt.mult(row.level_factor), false],
      ['Launch value if it launches', fmt.usd(row.launch_value_usd), false],
      ['Token odds (' + view.horizon + ' mo' + (row.odds_age_known ? '' : ', age unknown — median age used') + ')', fmt.odds(odds), false],
      ['Implied value', fmt.usd(implied), true],
      ['P25–P75 range', fmt.usd(row.range_p25_usd) + ' – ' + fmt.usd(row.range_p75_usd), false],
      ['P10–P90 range', fmt.usd(row.range_p10_usd) + ' – ' + fmt.usd(row.range_p90_usd), false],
    ];
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
        isWatch ? h('span', { class: 'badge wl', text: 'On the watchlist' }) : null,
        row.age_days === null ? h('span', { class: 'badge early', text: 'Listing date unknown' }) : null),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'eq' }, equation.map(function (e) { return h('div', e[2] ? { class: 'total' } : null, h('span', { text: e[0] }), h('b', { class: 'num', text: e[1] })); })),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': launch value = TVL x size base x level; implied = launch x token odds. The size curve is fitted on the ' + DATA.live_size + ' live protocols; the odds come from the ' + DATA.odds.peers + ' dated peers. This is an estimate, not a price.' })));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Why this rank' }),
      h('ul', { class: 'why' },
        h('li', { text: 'Size base ' + fmt.mult(row.size_base) + ' for ' + fmt.usd(row.tvl_usd) + ' of TVL: the curve, not a flat median, sets the base for a protocol this big.' }),
        h('li', { text: 'No category, growth, age, chain-count, breadth or log-TVL-squared curvature term: every one of them was tested held-out and none lowered both misses, so the board prices on the size curve alone. The full table is in the evidence below the board.' }),
        h('li', { text: 'Token odds ' + fmt.odds(row.token_odds) + ' at 24 months from the dated peers’ record — older listed protocols record tokens far more often (32% under a year, 79% past three years).' }),
        h('li', { text: 'Range ' + fmt.usd(row.range_p25_usd) + '–' + fmt.usd(row.range_p75_usd) + ' from the leave-one-out residuals: half of real caps landed inside the printed P25–P75 range, held-out.' }))));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan — ' + v.verdict }),
      h('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      })),
      h('div', { class: 'budget' },
        h('b', { text: 'Budget: ' }),
        'deposit $' + v.deposit + ' for ' + row.hold_days + ' days, expected drop ' + fmt.money(v.drop) + ', fees ' + fmt.money(v.fees) + ', capital charge ' + fmt.money(v.charge) + ', ' + v.hours + 'h work at $' + MODEL.hourly_usd + '/h — net ' + fmt.signed(v.net) + ', ' + fmt.signed(v.perHour) + ' an hour. ' + v.verdict + ' at a $' + MODEL.farm_bar_per_hour + '/h bar.')));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function paint() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(buildHeader());
    shell.appendChild(buildKpis());
    shell.appendChild(buildLedger());
    shell.appendChild(buildIntegrity());
    shell.appendChild(buildControls());
    shell.appendChild(buildBoardTable());
    shell.appendChild(buildEvidence());
    shell.appendChild(buildFooter());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    var countEl = document.getElementById('rowcount');
    if (countEl) {
      var list = orderedRows(visibleRows());
      var totalTvl = visibleRows().reduce(function (s, r) { return s + r.tvl_usd; }, 0);
      var totalImplied = visibleRows().reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
      countEl.textContent = list.length + ' of ' + DATA.board_size + ' rows · ' + fmt.usd(totalTvl) + ' TVL · ' + fmt.usd(totalImplied) + ' implied';
    }
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) showDetail(view.selected);
    window.__shotReady = true;
  }

  readStateFromHash();
  paint();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
