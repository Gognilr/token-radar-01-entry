// Token Radar — the dashboard. No network, no fetch: all data arrives in data.js
// as window.RADAR, and every view below is rendered from it in the page.
//
// Views: the pre-token board (sortable, filterable, with a detail panel per
// protocol), the already-trading list, and the model page with a live sandbox
// that re-ranks the board from the same snapshot figures when a dial moves.
// Hash routes: #detail=<slug> opens a protocol, #cat=<category> filters by
// category, #watchlist=1 shows the watchlist only.

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) {
    document.body.innerHTML = '<p style="padding:24px">Token Radar could not load its data.</p>';
    return;
  }

  var rows = R.rows.slice();
  var live = R.live.slice();
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  /* ---------- formatting ---------- */
  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return (days / 30).toFixed(0) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- header, stats, meta ---------- */
  var el = function (id) { return document.getElementById(id); };
  el('asof').innerHTML = 'Snapshot <b>' + esc(R.as_of) + '</b><br>' + R.rows.length + ' ranked · ' + R.watchlist_size + ' on the watchlist';
  el('model-version').textContent = R.model_version;
  el('foot-asof').textContent = R.as_of;
  el('foot-source').textContent = R.source;
  el('model-meta').textContent =
    'Model ' + R.model_version + ' · base multiple ' + R.model.base_multiple + ' · growth weight ' + R.model.growth_weight +
    ' · maturity ' + R.model.maturity_floor + ' + ' + R.model.maturity_range + ' over ' + R.model.maturity_days + ' days' +
    ' · breadth +' + R.model.breadth_per_chain + ' per extra chain (max ' + R.model.breadth_max_chains + ')' +
    ' · watchlist floor ' + moneyFull(R.floor_usd) + ' · source: ' + R.source + '.';

  var watchRows = rows.filter(function (r) { return r.on_watchlist; });
  el('stats').innerHTML =
    stat('Ranked protocols', String(rows.length), rows.length - R.watchlist_size + ' early finds below the floor') +
    stat('Watchlist covered', R.watchlist_size + ' / ' + R.watchlist_size, 'every watchlist protocol is ranked') +
    stat('Total implied value', money(R.total_implied_usd), 'top protocol ' + money(rows[0].implied_value_usd)) +
    stat('Already trading', String(R.live_size), 'shown with market caps, never ranked');
  function stat(k, v, s) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + esc(s) + '</div></div>';
  }

  /* ---------- filter controls ---------- */
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var chains = [];
  rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
  chains.sort();
  fillSelect(el('cat'), cats);
  fillSelect(el('chain'), chains);
  function fillSelect(sel, values) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }

  /* ---------- board state ---------- */
  var state = { q: '', cat: '', chain: '', watchonly: false, sort: 'value', dir: -1 };
  var sandbox = null; // null = submitted model; else {base, growth, mat}

  function recompute(r) {
    if (!sandbox) return r.implied_value_usd;
    var growthPct = Math.min(150, Math.max(-50, r.change_7d === null ? 0 : r.change_7d));
    var growthMult = 1 + (growthPct / 100) * sandbox.growth;
    var age = r.age_days === null ? 365 : r.age_days;
    var matMult = 0.7 + (Math.min(age, 1460) / 1460) * sandbox.mat;
    var breadth = 1 + 0.015 * Math.min(Math.max(r.chains.length - 1, 0), 12);
    return Math.max(1, Math.round(r.tvl_usd * sandbox.base * growthMult * matMult * breadth));
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchonly && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    list.sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return list;
  }
  function sortVal(r, key) {
    if (key === 'value') return recompute(r);
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -999 : r.change_7d;
    if (key === 'age') return r.age_days === null ? -1 : r.age_days;
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'rank') return r.rank;
    return r.implied_value_usd;
  }

  function renderBoard() {
    var list = filtered();
    var tbody = el('rows');
    var html = '';
    if (list.length === 0) {
      html = '<tr><td colspan="6" class="empty">Nothing matches those filters. Clear the search or pick another category.</td></tr>';
    } else {
      list.forEach(function (r) {
        var v = recompute(r);
        html += '<tr data-slug="' + esc(r.slug) + '">' +
          '<td class="num">' + r.rank + '</td>' +
          '<td><span class="name">' + esc(r.name) + '</span>' +
          (r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : '') +
          '<span class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</span></td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num">' + pct(r.change_7d) + '</td>' +
          '<td class="num">' + ageText(r.age_days) + '</td>' +
          '<td class="num val">' + money(v) + '</td></tr>';
      });
    }
    tbody.innerHTML = html;
    el('count').innerHTML = 'Showing <b>' + list.length + '</b> of ' + rows.length + ' ranked protocols' +
      (sandbox ? ' · <b>sandbox model</b> — re-ranked with your dials, not the submitted constants' : '');
    markSortedHeader();
  }

  function markSortedHeader() {
    var ths = document.querySelectorAll('#board thead th');
    ths.forEach(function (th) {
      var k = th.getAttribute('data-sort');
      th.classList.toggle('sorted', (k === 'value' && state.sort === 'value') || k === state.sort);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + ((k === 'value' && state.sort === 'value') || k === state.sort ? (state.dir === -1 ? ' ▼' : ' ▲') : '');
    });
  }

  /* ---------- detail panel ---------- */
  function openDetail(slug) {
    var r = bySlug[slug];
    var panel = el('detail');
    if (!r) { panel.hidden = true; panel.innerHTML = ''; return; }
    var v = recompute(r);
    var growthPct = Math.min(150, Math.max(-50, r.change_7d === null ? 0 : r.change_7d));
    var steps = (r.farm_steps || []).map(function (s) {
      var m = s.match(/^(.*?)\s*Cost:\s*(.*?)\s*Time:\s*(.*?)\.?$/);
      if (!m) return '<li>' + esc(s) + '</li>';
      return '<li>' + esc(m[1]) + '<span class="chips"><span class="chip">Cost: <b>' + esc(m[2]) + '</b></span>' +
        '<span class="chip">Time: <b>' + esc(m[3]) + '</b></span></span></li>';
    }).join('');
    panel.innerHTML =
      '<button class="close-detail" type="button" id="detail-close">Close ✕</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || '—') +
      ' · TVL ' + moneyFull(r.tvl_usd) + ' · 7-day ' + (r.change_7d === null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + (r.on_watchlist ? ' · <b style="color:var(--amber)">On the watchlist</b>' : '') + '</p>' +
      '<h3>Why this rank — model ' + esc(R.model_version) + '</h3>' +
      '<div class="mult">' +
      mult('Implied value', moneyFull(v), 100) +
      mult('Growth ×' + r.growth_multiplier.toFixed(2), growthPct.toFixed(1) + '% over 7 days', Math.min(100, Math.max(0, (r.growth_multiplier - 0.7) / 0.9 * 100))) +
      mult('Maturity ×' + r.maturity_multiplier.toFixed(2), ageText(r.age_days) + ' with no token', Math.min(100, (r.maturity_multiplier - 0.7) / 0.3 * 100)) +
      mult('Breadth ×' + r.breadth_multiplier.toFixed(2), r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), Math.min(100, (r.breadth_multiplier - 1) / 0.18 * 100)) +
      '</div>' +
      '<h3>How to farm it</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="fine">This protocol records no token in the snapshot — that is what the record says, not proof it has none. Verify on the protocol’s own pages before you move funds.</p>';
    panel.hidden = false;
    el('detail-close').addEventListener('click', function () {
      panel.hidden = true;
      if (location.hash.indexOf('detail=') >= 0) history.replaceState(null, '', location.pathname + location.search);
      document.querySelectorAll('#board tbody tr.selected').forEach(function (tr) { tr.classList.remove('selected'); });
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.querySelectorAll('#board tbody tr.selected').forEach(function (tr) { tr.classList.remove('selected'); });
    var tr = document.querySelector('#board tbody tr[data-slug="' + slug + '"]');
    if (tr) tr.classList.add('selected');
    function mult(k, v, pctBar) {
      return '<div class="m"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="bar"><i style="width:' + Math.round(pctBar) + '%"></i></div></div>';
    }
  }

  /* ---------- live view ---------- */
  el('live-rows').innerHTML = live.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><span class="sub">' + esc(p.category || 'Uncategorised') + ' · ' + esc(p.chains.slice(0, 3).join(', ') || '—') + '</span></td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num val">' + (p.mcap_usd === null ? '—' : money(p.mcap_usd)) + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  /* ---------- tabs ---------- */
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { showView(tab.getAttribute('data-view')); });
  });
  function showView(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-view') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['board', 'live', 'model'].forEach(function (v) {
      el('view-' + v).hidden = v !== name;
    });
  }

  /* ---------- events ---------- */
  el('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  el('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  el('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  el('watchonly').addEventListener('change', function (e) { state.watchonly = e.target.checked; renderBoard(); });
  el('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = state.sort === 'name' ? 1 : -1;
    renderBoard();
  });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) { state.dir = -state.dir; }
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      var sel = el('sort');
      if (['value', 'tvl', 'growth', 'age', 'name'].indexOf(key) >= 0) sel.value = key;
      renderBoard();
    });
  });
  el('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  /* ---------- sandbox ---------- */
  var sBase = el('s-base'), sGrowth = el('s-growth'), sMat = el('s-mat');
  function readSandbox() {
    sandbox = {
      base: parseFloat(sBase.value),
      growth: parseFloat(sGrowth.value),
      mat: parseFloat(sMat.value),
    };
    el('o-base').textContent = sandbox.base.toFixed(2);
    el('o-growth').textContent = sandbox.growth.toFixed(2);
    el('o-mat').textContent = sandbox.mat.toFixed(2);
    var submitted = Math.abs(sandbox.base - R.model.base_multiple) < 0.001 &&
      Math.abs(sandbox.growth - R.model.growth_weight) < 0.001 &&
      Math.abs(sandbox.mat - R.model.maturity_range) < 0.001;
    if (submitted) {
      sandbox = null;
      el('sandbox-note').textContent = 'Sandbox is off — the board shows the submitted model.';
    } else {
      el('sandbox-note').textContent = 'Sandbox is ON — the board is re-ranked with your dials. The submitted board always uses the constants on the left.';
    }
    renderBoard();
  }
  [sBase, sGrowth, sMat].forEach(function (s) { s.addEventListener('input', readSandbox); });
  el('sandbox-reset').addEventListener('click', function () {
    sBase.value = String(R.model.base_multiple);
    sGrowth.value = String(R.model.growth_weight);
    sMat.value = String(R.model.maturity_range);
    readSandbox();
  });

  /* ---------- hash routes (board / detail / filtered views) ---------- */
  function applyHash() {
    var h = location.hash || '';
    var m;
    if ((m = h.match(/detail=([^&]+)/))) { openDetail(decodeURIComponent(m[1])); return; }
    if ((m = h.match(/cat=([^&]+)/))) {
      state.cat = decodeURIComponent(m[1]);
      el('cat').value = state.cat;
    }
    if (h.indexOf('watchlist=1') >= 0) {
      state.watchonly = true;
      el('watchonly').checked = true;
    }
    renderBoard();
  }

  renderBoard();
  applyHash();
  window.addEventListener('hashchange', applyHash);
})();
