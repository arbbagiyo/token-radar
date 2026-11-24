// Token Radar, radar-4: the dashboard, rewritten.
//
// It mounts on #board, reads window.RADAR (the data.js main.ts writes beside
// dashboard/) and paints the ranked board first, the five strongest rows and the
// model notes underneath, plus the filters, the live-token table and one detail
// drawer per protocol. Nothing here fetches: every number on screen comes from
// data.js. The drawer recomputes a row's implied value from its stored factors
// (level included) and says so when the recomputed figure matches board.json.
// The farm plan is printed exactly as board.json carries it.

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');

  // What the reader has picked: search text, filters, tab, sort order, open row.
  var view = {
    q: '',
    category: 'all',
    chain: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    watchOnly: false,
    minTvl: 0,
  };

  var usdPlain = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  // Every number on the page goes through one of these four, so a value means
  // the same thing in the table, the drawer and the top five.
  var fmt = {
    usd: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return usdPlain.format(n);
    },
    pct: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    },
    age: function (days) {
      if (days === null || days === undefined) return 'unknown';
      if (days >= 365) return (days / 365).toFixed(1) + 'y';
      return Math.max(0, Math.round(days)) + 'd';
    },
    mult: function (n) {
      return 'x' + n.toFixed(2);
    },
  };

  // The same arithmetic main.ts runs, in one place: TVL x comp x growth x
  // maturity x breadth x level, where comp is the size curve's base for this
  // TVL times the category's shrunk factor, and level centres the backtest.
  function recompute(row) {
    var level = row.level_factor || DATA.level_factor || 1;
    var value =
      row.tvl_usd *
      row.comp_ratio *
      row.growth_multiplier *
      row.maturity_multiplier *
      row.breadth_multiplier *
      level;
    return Math.max(1, Math.round(value));
  }

  // Tiny DOM builder: h('td', { class: 'num', text: '1' }, child, 'text').
  // Attributes named class/text/html get their own treatment, on* becomes a
  // listener, anything else is set as an attribute unless it is null.
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
    var kids = Array.prototype.slice.call(arguments, 2);
    kids.forEach(function (kid) {
      if (kid === null || kid === undefined) return;
      if (Array.isArray(kid)) {
        kid.forEach(function (c) {
          if (c) node.appendChild(c);
        });
      } else if (typeof kid === 'string') {
        node.appendChild(document.createTextNode(kid));
      } else {
        node.appendChild(kid);
      }
    });
    return node;
  }

  // The pick survives a reload through the URL hash, so a filtered board and
  // an open drawer are both linkable.
  function readStateFromHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('tab')) view.tab = params.get('tab');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('watch') === '1') view.watchOnly = true;
    if (params.get('minTvl')) view.minTvl = Number(params.get('minTvl')) || 0;
  }
  function writeStateToHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.tab !== 'pre-token') params.set('tab', view.tab);
    if (view.selected) params.set('p', view.selected);
    if (view.watchOnly) params.set('watch', '1');
    if (view.minTvl) params.set('minTvl', String(view.minTvl));
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The board after the reader's filters: watchlist-only, a TVL floor, one
  // category, one chain, and a search over name, slug, category and chains.
  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    var watchlist = DATA.watchlist || [];
    return DATA.rows.filter(function (r) {
      if (view.watchOnly && watchlist.indexOf(r.slug) < 0) return false;
      if (view.minTvl && r.tvl_usd < view.minTvl) return false;
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).includes(view.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  // One value per sort key; an unreported 7-day change sorts last on growth,
  // an unknown age sorts last on age, and equal values break on slug so the
  // order is stable whichever way the column points.
  var sortValues = {
    name: function (r) {
      return r.name.toLowerCase();
    },
    tvl: function (r) {
      return r.tvl_usd;
    },
    growth: function (r) {
      return r.change_7d === null ? -Infinity : r.change_7d;
    },
    age: function (r) {
      return r.age_days === null ? Infinity : r.age_days;
    },
    comp: function (r) {
      return r.comp_ratio;
    },
    rank: function (r) {
      return r.rank;
    },
    implied: function (r) {
      return r.implied_value_usd;
    },
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

  function buildHeader() {
    return h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'brand' },
        h('span', { class: 'dial', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name' }, h('b', { text: 'Token Radar' }), 'Pre-token launches, ranked')
      ),
      h(
        'div',
        { class: 'top-meta' },
        h('span', null, h('span', { class: 'dot', text: '● ' }), 'live snapshot ' + DATA.as_of),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function buildLede() {
    var top = DATA.rows[0];
    return h(
      'section',
      { class: 'lede' },
      h(
        'div',
        null,
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h(
          'p',
          null,
          'The watchlist is the floor: every protocol with at least ',
          h('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL' }),
          ' and no token on record, plus ',
          h('b', { text: String(DATA.early_size) + ' early pre-token protocols' }),
          ' below that floor. Live-token protocols are kept apart, with their market caps. Implied value is a model, not a promise — never a prediction of whether a token launches.'
        )
      ),
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), h('span', { text: 'Watchlist covered' })),
        h('div', { class: 'stat' }, h('b', { text: String(DATA.board_size) }), h('span', { text: 'Pre-token rows' })),
        h('div', { class: 'stat' }, h('b', { text: top ? fmt.usd(top.implied_value_usd) : 'n/a' }), h('span', { text: 'Top implied value' })),
        h('div', { class: 'stat' }, h('b', { text: fmt.mult(DATA.global_comp) }), h('span', { text: 'Median mcap / TVL, live' }))
      )
    );
  }

  // The whole model in two lines: the formula, then the in-sample backtest.
  // It sits above the table but stays small, so the board still starts near
  // the top of the page.
  function buildModelStrip() {
    var m = DATA.model;
    var f = DATA.size_fit;
    var b = DATA.backtest;
    return h(
      'section',
      { class: 'model-strip' },
      h(
        'div',
        { class: 'formula' },
        h('b', { text: 'implied = TVL x comp x growth x maturity x breadth x level   ' }),
        'comp = 10^(' +
          f.intercept +
          ' + ' +
          f.slope +
          ' x log10 TVL) x catFactor, growth = 1 + ' +
          m.growth_weight +
          ' x tanh(7d / 100), maturity to ' +
          (m.maturity_floor + m.maturity_range).toFixed(2) +
          ', level x' +
          DATA.level_factor.toFixed(2) +
          ' from the live set.'
      ),
      h(
        'div',
        { class: 'check' },
        h('b', { text: 'Backtest (in-sample): ' }),
        'the ' + b.members + ' live protocols score a median ',
        h('b', { text: fmt.mult(b.median_factor_error) }),
        ' from their real market caps — ' + b.within_3x + ' inside 3x, ' + b.within_10x + ' inside 10x. Live-token rows are shown separately, never ranked.'
      )
    );
  }

  function option(value, text, isSelected) {
    return h('option', { value: value, text: text, selected: isSelected ? 'selected' : null });
  }
  function field(labelFor, labelText, control) {
    return h('div', { class: 'field' }, h('label', { for: labelFor, text: labelText }), control);
  }

  function buildControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) {
      return r.category || 'Other';
    }))).sort();
    var chains = Array.from(
      new Set(
        DATA.rows.reduce(function (acc, r) {
          return acc.concat(r.chains || []);
        }, [])
      )
    ).sort();

    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search the board', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      view.q = search.value;
      writeStateToHash();
      paint();
    });

    var catSelect = h(
      'select',
      { id: 'category', 'aria-label': 'Filter by category' },
      option('all', 'All categories', view.category === 'all'),
      categories.map(function (c) {
        return option(c, c, c === view.category);
      })
    );
    catSelect.addEventListener('change', function () {
      view.category = catSelect.value;
      writeStateToHash();
      paint();
    });

    var chainSelect = h(
      'select',
      { id: 'chain', 'aria-label': 'Filter by chain' },
      option('all', 'All chains', view.chain === 'all'),
      chains.map(function (c) {
        return option(c, c, c === view.chain);
      })
    );
    chainSelect.addEventListener('change', function () {
      view.chain = chainSelect.value;
      writeStateToHash();
      paint();
    });

    var tvlSelect = h(
      'select',
      { id: 'minTvl', 'aria-label': 'Filter by minimum TVL' },
      option('0', 'Any TVL', view.minTvl === 0),
      option('50000000', '$50M TVL or more', view.minTvl === 50000000),
      option('100000000', '$100M TVL or more', view.minTvl === 100000000),
      option('500000000', '$500M TVL or more', view.minTvl === 500000000)
    );
    tvlSelect.addEventListener('change', function () {
      view.minTvl = Number(tvlSelect.value) || 0;
      writeStateToHash();
      paint();
    });

    var watchBox = h('input', { type: 'checkbox', id: 'watch', checked: view.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () {
      view.watchOnly = watchBox.checked;
      writeStateToHash();
      paint();
    });

    var pre = h('button', {
      type: 'button',
      'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-token',
      onclick: function () {
        view.tab = 'pre-token';
        paint();
      },
    });
    var live = h('button', {
      type: 'button',
      'aria-pressed': view.tab === 'live' ? 'true' : 'false',
      text: 'Live token',
      onclick: function () {
        view.tab = 'live';
        paint();
      },
    });

    var countText =
      view.tab === 'pre-token'
        ? visibleRows().length + ' of ' + DATA.board_size + ' rows'
        : DATA.live.length + ' live-token protocols';

    return h(
      'div',
      { class: 'controls' },
      field('q', 'Search', search),
      field('category', 'Category', catSelect),
      field('chain', 'Chain', chainSelect),
      field('minTvl', 'Minimum TVL', tvlSelect),
      h('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: countText })
    );
  }

  function sortButton(key, label) {
    var active = view.sort === key;
    return h(
      'th',
      { scope: 'col' },
      h(
        'button',
        {
          type: 'button',
          onclick: function () {
            if (view.sort === key) view.dir = -view.dir;
            else {
              view.sort = key;
              view.dir = -1;
            }
            paint();
          },
        },
        label,
        active ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function chainsLabel(r) {
    return (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain');
  }

  function boardRow(r, max) {
    var growth = r.change_7d === null ? 'n/a' : fmt.pct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var barWidth = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
    return h(
      'tr',
      {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () {
          showDetail(r.slug);
        },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            showDetail(r.slug);
          }
        },
      },
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: chainsLabel(r) }))),
      h('td', { class: 'num', text: fmt.usd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: fmt.age(r.age_days) }),
      h('td', { class: 'num', text: fmt.mult(r.comp_ratio) }),
      h(
        'td',
        null,
        h(
          'div',
          { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + barWidth + '%' })),
          h('span', { class: 'num', text: fmt.usd(r.implied_value_usd) })
        )
      ),
      h('td', null, h('span', { class: 'tag pre', text: 'no token' }))
    );
  }

  function buildBoardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'empty' },
          h('h2', { text: 'No protocol matches that filter' }),
          h('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
          h(
            'button',
            {
              class: 'button primary',
              type: 'button',
              text: 'Clear filters',
              onclick: function () {
                view.q = '';
                view.category = 'all';
                view.chain = 'all';
                view.watchOnly = false;
                view.minTvl = 0;
                writeStateToHash();
                paint();
              },
            }
          )
        )
      );
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      tbody.appendChild(boardRow(r, max));
    });
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: 'caption', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              sortButton('rank', 'Rank'),
              sortButton('name', 'Protocol'),
              sortButton('tvl', 'TVL'),
              sortButton('growth', '7d'),
              sortButton('age', 'Age'),
              sortButton('comp', 'Comp'),
              sortButton('implied', 'Implied value'),
              h('th', { scope: 'col', text: 'Token' })
            )
          ),
          tbody
        )
      )
    );
  }

  function liveRow(r) {
    var growthClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
    return h(
      'tr',
      null,
      h('td', { class: 'num', text: 'live' }),
      h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: chainsLabel(r) }))),
      h('td', { class: 'num', text: fmt.usd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: fmt.pct(r.change_7d) }),
      h('td', { class: 'num', text: fmt.usd(r.mcap_usd) }),
      h('td', null, h('span', { class: 'tag live', text: 'already trades' }))
    );
  }

  function buildLiveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(liveRow(r));
    });
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: 'caption', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their ratios are what calibrate it.' }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col', text: 'Status' }),
              h('th', { scope: 'col', text: 'Protocol' }),
              h('th', { scope: 'col', text: 'TVL' }),
              h('th', { scope: 'col', text: '7d' }),
              h('th', { scope: 'col', text: 'Market cap' }),
              h('th', { scope: 'col', text: 'Token' })
            )
          ),
          tbody
        )
      )
    );
  }

  // The five strongest rows, below the table — never above it, so the board
  // is the first thing a reader sees.
  function buildTopFive() {
    var top5 = DATA.rows.slice(0, 5);
    return h(
      'section',
      { class: 'top5' },
      h('h2', { text: 'Farm these five first' }),
      h(
        'div',
        { class: 'top5-grid' },
        top5.map(function (r) {
          var why = (r.category || 'Other') + ' · ' + fmt.usd(r.tvl_usd) + ' TVL · ' + fmt.pct(r.change_7d) + ' in 7d';
          return h(
            'button',
            {
              type: 'button',
              class: 'top5-card',
              onclick: function () {
                showDetail(r.slug);
              },
            },
            h('span', { class: 'rank', text: 'Rank ' + r.rank }),
            h('b', { text: r.name }),
            h('span', { class: 'val', text: fmt.usd(r.implied_value_usd) }),
            h('span', { class: 'why', text: why })
          );
        })
      )
    );
  }

  function compList(entries) {
    return h(
      'div',
      { class: 'comp-list' },
      entries.map(function (c) {
        return h('div', null, h('span', { text: c.category + ' (' + c.members + ' live)' }), h('b', { text: fmt.mult(c.factor) }));
      })
    );
  }

  function buildModelPanel() {
    var m = DATA.model;
    var f = DATA.size_fit;
    var b = DATA.backtest;
    var topComps = DATA.comps.slice(0, 6);
    var lowComps = DATA.comps.slice(-4);
    return h(
      'section',
      { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'note', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased and no row is hand-picked.' }),
      h(
        'p',
        { class: 'note' },
        'implied = round(tvl_usd x comp x growth x maturity x breadth x level), where comp = sizeBase(tvl_usd) x catFactor(category), ' +
          'sizeBase = 10 ^ (' +
          f.intercept +
          ' + ' +
          f.slope +
          ' x log10(tvl_usd)), growth = 1 + ' +
          m.growth_weight +
          ' x tanh(clamp(change_7d, ' +
          m.growth_floor +
          ', ' +
          m.growth_cap +
          ') / 100), ' +
          'maturity = ' +
          m.maturity_floor +
          ' + min(age_days, ' +
          m.maturity_days +
          ') / ' +
          m.maturity_days +
          ' x ' +
          m.maturity_range +
          ' (x ' +
          m.young_discount +
          ' under ' +
          m.young_age_days +
          ' days), ' +
          'breadth = 1 + ' +
          m.breadth_step +
          ' per extra chain, at most ' +
          (1 + m.breadth_step * m.breadth_max_extra_chains).toFixed(2) +
          ', ' +
          'level = x' +
          DATA.level_factor.toFixed(2) +
          ', computed from the live set on this run as 10^(-median signed log10(implied/mcap)) before the correction, so the backtest median bias is centred at zero.'
      ),
      h(
        'p',
        { class: 'note' },
        h('b', { text: 'Model check (in-sample): ' }),
        'scored as if they had no token, the ' + b.members + ' live protocols the multiples were calibrated from come out a median ',
        h('b', { text: fmt.mult(b.median_factor_error) }),
        ' from their real market caps, with ' + b.within_3x + ' of ' + b.members + ' inside 3x and ' + b.within_10x + ' inside 10x. ',
        'That is an in-sample calibration check, not out-of-sample proof — and it is why big protocols are no longer scored at small-cap multiples: the median live ratio is 0.42 below $50M of TVL but 0.03 above $1B.'
      ),
      h(
        'div',
        { class: 'model-grid' },
        h('div', null, h('h3', { text: 'Highest category factors' }), compList(topComps)),
        h('div', null, h('h3', { text: 'Lowest category factors' }), compList(lowComps))
      ),
      h(
        'p',
        { class: 'note' },
        'The size curve is a least-squares line through the live protocols, after winsorising each live ratio to [' +
          m.winsor_low +
          ', ' +
          m.winsor_high +
          ']. ' +
          'Each category factor is that category’s median residual from the line, shrunk toward 1 with a prior weight of ' +
          m.shrink_prior +
          ' and clamped to [' +
          m.cat_factor_floor +
          ', ' +
          m.cat_factor_cap +
          ']; a category with no live member gets factor 1. ' +
          'comp is clamped to [' +
          m.comp_floor +
          ', ' +
          m.comp_cap +
          ']. An unreported 7-day change is discounted by ' +
          m.unknown_growth_discount +
          ', never treated as a flat week, and an unlisted age is scored at ' +
          m.unknown_age_days +
          ' days. ' +
          'Bridges, liquid staking, restaking and exchange products are left out of the ranking: any token they issue belongs to a parent protocol, not to the product.'
      )
    );
  }

  function buildFooter() {
    return h(
      'footer',
      { class: 'foot' },
      h('span', { text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source }),
      h('span', { text: 'Implied value is the entry’s own claim, never a price. Say a protocol records no token, never that it has none.' })
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    view.selected = null;
    writeStateToHash();
  });

  // Why this row ranks where it does, in the reader's words: the size base,
  // the category factor, the growth, the maturity, the breadth and the level
  // correction, plus every data-quality discount applied.
  function explainWhy(row) {
    var chainCount = (row.chains || []).length;
    return [
      'Size base ' +
        fmt.mult(row.size_base) +
        ' for ' +
        fmt.usd(row.tvl_usd) +
        ' of TVL: the curve, not a flat median, sets the base for a protocol this big.',
      'Category factor ' +
        fmt.mult(row.cat_factor) +
        ' for ' +
        (row.category || 'Other') +
        ', from ' +
        row.comp_members +
        ' live protocol' +
        (row.comp_members === 1 ? '' : 's') +
        ' in the category, shrunk toward 1.',
      'Growth ' +
        fmt.mult(row.growth_multiplier) +
        ' on ' +
        (row.growth_reported ? fmt.pct(row.change_7d) + ' over 7 days' : 'an unreported 7-day change, discounted for missing data') +
        '.',
      'Maturity ' +
        fmt.mult(row.maturity_multiplier) +
        ' for ' +
        fmt.age(row.age_days) +
        ' listed with no token' +
        (row.young ? ', including the young-listing haircut' : '') +
        '.',
      'Breadth ' + fmt.mult(row.breadth_multiplier) + ' for running on ' + chainCount + ' chain' + (chainCount === 1 ? '' : 's') + '.',
      'Level ' +
        fmt.mult(row.level_factor || DATA.level_factor) +
        ', the correction that centres the live backtest at zero median bias, applied to every row alike.',
    ];
  }

  function showDetail(slug) {
    var row = DATA.rows.filter(function (r) {
      return r.slug === slug;
    })[0];
    if (!row) return;
    view.selected = slug;
    writeStateToHash();
    dialog.textContent = '';
    var recomputed = recompute(row);
    var agrees = recomputed === row.implied_value_usd;
    var isWatch = (DATA.watchlist || []).indexOf(row.slug) >= 0;

    var equation = [
      ['TVL', fmt.usd(row.tvl_usd), false],
      ['Size base for this TVL', fmt.mult(row.size_base), false],
      ['Category factor (' + row.comp_members + ' live)', fmt.mult(row.cat_factor), false],
      ['Category multiple', fmt.mult(row.comp_ratio), false],
      ['Seven-day growth', fmt.pct(row.change_7d), false],
      ['Growth factor', fmt.mult(row.growth_multiplier), false],
      ['Age with no token', fmt.age(row.age_days), false],
      ['Maturity factor', fmt.mult(row.maturity_multiplier), false],
      ['Breadth factor', fmt.mult(row.breadth_multiplier), false],
      ['Level factor', fmt.mult(row.level_factor || DATA.level_factor), false],
      ['Implied value', fmt.usd(row.implied_value_usd), true],
    ];

    dialog.appendChild(
      h(
        'div',
        { class: 'detail-head' },
        h(
          'div',
          null,
          h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
          h('h2', { id: 'detail-title', text: row.name }),
          h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
          isWatch ? h('span', { class: 'watch', text: 'On the watchlist' }) : null,
          row.young ? h('span', { class: 'flag', text: 'Listed under 90 days' }) : null,
          !row.growth_reported ? h('span', { class: 'flag', text: '7-day change unreported' }) : null,
          row.age_days === null ? h('span', { class: 'flag', text: 'Listing date unknown' }) : null
        ),
        h('button', {
          class: 'close',
          type: 'button',
          'aria-label': 'Close details',
          text: 'Close',
          onclick: function () {
            dialog.close();
          },
        })
      )
    );
    dialog.appendChild(
      h(
        'section',
        { class: 'detail-section' },
        h('h3', { text: 'Implied value' }),
        h(
          'div',
          { class: 'equation' },
          equation.map(function (entry) {
            return h('div', entry[2] ? { class: 'total' } : null, h('span', { text: entry[0] }), h('b', { class: 'num', text: entry[1] }));
          })
        ),
        h('p', {
          class: 'sub',
          text:
            'Model ' +
            DATA.model_version +
            ': the page recomputes this row as ' +
            fmt.usd(recomputed) +
            (agrees ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') +
            ' This is an estimate, not a price.',
        })
      )
    );
    dialog.appendChild(
      h(
        'section',
        { class: 'detail-section' },
        h('h3', { text: 'Why this rank' }),
        h(
          'ul',
          { class: 'why' },
          explainWhy(row).map(function (w) {
            return h('li', { text: w });
          })
        )
      )
    );
    dialog.appendChild(
      h(
        'section',
        { class: 'detail-section' },
        h('h3', { text: 'Farm plan' }),
        h(
          'ol',
          { class: 'steps' },
          (row.farm_steps || []).map(function (s) {
            var at = s.indexOf(' Cost: ');
            var action = at >= 0 ? s.slice(0, at) : s;
            var tail = at >= 0 ? s.slice(at + 1) : '';
            return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
          })
        )
      )
    );
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function paint() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(buildHeader());
    shell.appendChild(buildLede());
    if (view.tab === 'pre-token') shell.appendChild(buildModelStrip());
    shell.appendChild(buildControls());
    shell.appendChild(view.tab === 'pre-token' ? buildBoardTable() : buildLiveTable());
    if (view.tab === 'pre-token') {
      shell.appendChild(buildTopFive());
      shell.appendChild(buildModelPanel());
    }
    shell.appendChild(buildFooter());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) showDetail(view.selected);
    window.__shotReady = true;
  }

  readStateFromHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
