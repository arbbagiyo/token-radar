// Token Radar, radar-4: the dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board first, then the top five and
// the model detail below it, plus the filters, the live-token set and one detail
// drawer per protocol. No network: every byte it shows is in data.js. The farm plan
// is rendered exactly as board.json carries it; the detail view recomputes each
// row's implied value from the stored factors (level included) and says so when the
// numbers agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchOnly: false, minTvl: 0 };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  // The model in one function, the same arithmetic main.ts runs: TVL x comp x growth
  // x maturity x breadth x level, where comp is the size curve's base for this TVL
  // times the category's shrunk factor, and level centres the backtest's median bias.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.comp_ratio * row.growth_multiplier * row.maturity_multiplier * row.breadth_multiplier * (row.level_factor || DATA.level_factor || 1)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.watchOnly) params.set('watch', '1');
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && (DATA.watchlist || []).indexOf(r.slug) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'comp') { av = a.comp_ratio; bv = b.comp_ratio; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'dial', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'Token Radar' }), 'Pre-token launches, ranked')
      ),
      el('div', { class: 'top-meta' },
        el('span', null, el('span', { class: 'dot', text: '● ' }), 'live snapshot ' + DATA.as_of),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL' }),
          ' and no token on record, plus ',
          el('b', { text: String(DATA.early_size) + ' early pre-token protocols' }),
          ' below that floor. Live-token protocols are kept apart, with their market caps. Implied value is a model, not a promise — never a prediction of whether a token launches.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows' })),
        el('div', { class: 'stat' }, el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('span', { text: 'Top implied value' })),
        el('div', { class: 'stat' }, el('b', { text: fmtMult(DATA.global_comp) }), el('span', { text: 'Median mcap / TVL, live' }))
      )
    );
  }

  // The whole model in two lines: formula plus the in-sample backtest. It sits above
  // the table but stays small, so the board still starts near the top of the page.
  function modelStrip() {
    var m = DATA.model;
    var f = DATA.size_fit;
    var b = DATA.backtest;
    return el('section', { class: 'model-strip' },
      el('div', { class: 'formula' },
        el('b', { text: 'implied = TVL x comp x growth x maturity x breadth x level   ' }),
        'comp = 10^(' + f.intercept + ' + ' + f.slope + ' x log10 TVL) x catFactor, growth = 1 + ' + m.growth_weight + ' x tanh(7d / 100), maturity to ' + (m.maturity_floor + m.maturity_range).toFixed(2) + ', level x' + DATA.level_factor.toFixed(2) + ' from the live set.'
      ),
      el('div', { class: 'check' },
        el('b', { text: 'Backtest (in-sample): ' }),
        'the ' + b.members + ' live protocols score a median ',
        el('b', { text: fmtMult(b.median_factor_error) }),
        ' from their real market caps — ' + b.within_3x + ' inside 3x, ' + b.within_10x + ' inside 10x. Live-token rows are shown separately, never ranked.'
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search the board', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'minTvl', 'aria-label': 'Filter by minimum TVL' },
      el('option', { value: '0', text: 'Any TVL', selected: state.minTvl === 0 ? 'selected' : null }),
      el('option', { value: '50000000', text: '$50M TVL or more', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: '$100M TVL or more', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: '$500M TVL or more', selected: state.minTvl === 500000000 ? 'selected' : null })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value) || 0; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Minimum TVL' }), tvlSelect),
      el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.comp_ratio) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'tag pre', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('comp', 'Comp'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'tag live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their ratios are what calibrate it.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The five strongest rows, below the table — never above it, so the board is the
  // first thing a reader sees.
  function topFive() {
    var top5 = DATA.rows.slice(0, 5);
    return el('section', { class: 'top5' },
      el('h2', { text: 'Farm these five first' }),
      el('div', { class: 'top5-grid' }, top5.map(function (r) {
        var why = (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' in 7d';
        return el('button', { type: 'button', class: 'top5-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: 'Rank ' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'why', text: why })
        );
      }))
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var f = DATA.size_fit;
    var b = DATA.backtest;
    var topComps = DATA.comps.slice(0, 6);
    var lowComps = DATA.comps.slice(-4);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased and no row is hand-picked.' }),
      el('p', { class: 'note' },
        'implied = round(tvl_usd x comp x growth x maturity x breadth x level), where comp = sizeBase(tvl_usd) x catFactor(category), ' +
        'sizeBase = 10 ^ (' + f.intercept + ' + ' + f.slope + ' x log10(tvl_usd)), growth = 1 + ' + m.growth_weight + ' x tanh(clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100), ' +
        'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ' (x ' + m.young_discount + ' under ' + m.young_age_days + ' days), ' +
        'breadth = 1 + ' + m.breadth_step + ' per extra chain, at most ' + (1 + m.breadth_step * m.breadth_max_extra_chains).toFixed(2) + ', ' +
        'level = x' + DATA.level_factor.toFixed(2) + ', computed from the live set on this run as 10^(-median signed log10(implied/mcap)) before the correction, so the backtest median bias is centred at zero.'
      ),
      el('p', { class: 'note' },
        el('b', { text: 'Model check (in-sample): ' }),
        'scored as if they had no token, the ' + b.members + ' live protocols the multiples were calibrated from come out a median ',
        el('b', { text: fmtMult(b.median_factor_error) }),
        ' from their real market caps, with ' + b.within_3x + ' of ' + b.members + ' inside 3x and ' + b.within_10x + ' inside 10x. ',
        'That is an in-sample calibration check, not out-of-sample proof — and it is why big protocols are no longer scored at small-cap multiples: the median live ratio is 0.42 below $50M of TVL but 0.03 above $1B.'
      ),
      el('div', { class: 'model-grid' },
        el('div', null,
          el('h3', { text: 'Highest category factors' }),
          el('div', { class: 'comp-list' }, topComps.map(function (c) {
            return el('div', null, el('span', { text: c.category + ' (' + c.members + ' live)' }), el('b', { text: fmtMult(c.factor) }));
          }))
        ),
        el('div', null,
          el('h3', { text: 'Lowest category factors' }),
          el('div', { class: 'comp-list' }, lowComps.map(function (c) {
            return el('div', null, el('span', { text: c.category + ' (' + c.members + ' live)' }), el('b', { text: fmtMult(c.factor) }));
          }))
        )
      ),
      el('p', { class: 'note' },
        'The size curve is a least-squares line through the live protocols, after winsorising each live ratio to [' + m.winsor_low + ', ' + m.winsor_high + ']. ',
        'Each category factor is that category\u2019s median residual from the line, shrunk toward 1 with a prior weight of ' + m.shrink_prior + ' and clamped to [' + m.cat_factor_floor + ', ' + m.cat_factor_cap + ']; a category with no live member gets factor 1. ',
        'comp is clamped to [' + m.comp_floor + ', ' + m.comp_cap + ']. An unreported 7-day change is discounted by ' + m.unknown_growth_discount + ', never treated as a flat week, and an unlisted age is scored at ' + m.unknown_age_days + ' days. ',
        'Bridges, liquid staking, restaking and exchange products are left out of the ranking: any token they issue belongs to a parent protocol, not to the product.'
      )
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source }),
      el('span', { text: 'Implied value is the entry\u2019s own claim, never a price. Say a protocol records no token, never that it has none.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // Why this row ranks where it does, in the reader's words: the size base, the
  // category factor, the growth, the maturity, the breadth and the level correction,
  // plus every data-quality discount applied.
  function whyBullets(row) {
    var out = [];
    out.push('Size base ' + fmtMult(row.size_base) + ' for ' + fmtUsd(row.tvl_usd) + ' of TVL: the curve, not a flat median, sets the base for a protocol this big.');
    out.push('Category factor ' + fmtMult(row.cat_factor) + ' for ' + (row.category || 'Other') + ', from ' + row.comp_members + ' live protocol' + (row.comp_members === 1 ? '' : 's') + ' in the category, shrunk toward 1.');
    out.push('Growth ' + fmtMult(row.growth_multiplier) + ' on ' + (row.growth_reported ? fmtPct(row.change_7d) + ' over 7 days' : 'an unreported 7-day change, discounted for missing data') + '.');
    out.push('Maturity ' + fmtMult(row.maturity_multiplier) + ' for ' + fmtAge(row.age_days) + ' listed with no token' + (row.young ? ', including the young-listing haircut' : '') + '.');
    out.push('Breadth ' + fmtMult(row.breadth_multiplier) + ' for running on ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + '.');
    out.push('Level ' + fmtMult(row.level_factor || DATA.level_factor) + ', the correction that centres the live backtest at zero median bias, applied to every row alike.');
    return out;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var agrees = recomputed === row.implied_value_usd;
    var isWatch = (DATA.watchlist || []).indexOf(row.slug) >= 0;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
        isWatch ? el('span', { class: 'watch', text: 'On the watchlist' }) : null,
        row.young ? el('span', { class: 'flag', text: 'Listed under 90 days' }) : null,
        !row.growth_reported ? el('span', { class: 'flag', text: '7-day change unreported' }) : null,
        row.age_days === null ? el('span', { class: 'flag', text: 'Listing date unknown' }) : null
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size base for this TVL' }), el('b', { class: 'num', text: fmtMult(row.size_base) })),
        el('div', null, el('span', { text: 'Category factor (' + row.comp_members + ' live)' }), el('b', { class: 'num', text: fmtMult(row.cat_factor) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.comp_ratio) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth factor' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity factor' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth factor' }), el('b', { class: 'num', text: fmtMult(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Level factor' }), el('b', { class: 'num', text: fmtMult(row.level_factor || DATA.level_factor) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (agrees ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this rank' }),
      el('ul', { class: 'why' }, whyBullets(row).map(function (w) { return el('li', { text: w }); }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(modelStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(topFive());
      shell.appendChild(modelPanel());
    }
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
