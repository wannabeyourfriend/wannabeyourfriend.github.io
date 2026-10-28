/* Vibe coding telemetry — token river, cache donut, model bars, calendar heat,
   and the "token 即生产力" rain. Hand-drawn canvas/SVG, zero dependencies. */
(function () {
  'use strict';

  var FAM_COLOR = { claude: '#67828f', codex: '#c2b8aa' };
  var FAM_LABEL = { claude: 'claude code', codex: 'codex' };
  var SEG_COLOR = { cr: '#8aa6b5', cc: '#67828f', out: '#a9a3b8', in: '#9fae9b' };
  var SEG_LABEL = { cr: 'cache reads', cc: 'cache writes', out: 'output', in: 'fresh input' };

  function $(s, p) { return (p || document).querySelector(s); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return '' + Math.round(n);
  }
  function fmtUsd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtDate(value) { return value.replace(/-/g, '/'); }

  var DATA = null;
  var PASS_HASH = '742cce91672211e8ffe4ae0978846bb607d69ac28d61b87e26b00628750b4faa'; /* sha256 of the section password */

  function load() {
    $('#tokens').classList.remove('tok-locked');
    fetch('/assets/data/tokens.json')
      .then(function (r) { return r.json(); })
      .then(function (json) { DATA = json; init(json); })
      .catch(function () { /* section stays quiet without data */ });
  }

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  var saved = null;
  try { saved = localStorage.getItem('tok-pass'); } catch (e) {}
  if (saved === PASS_HASH) load();
  else $('#tok-lock').addEventListener('submit', function (e) {
    e.preventDefault();
    sha256($('#tok-pass').value).then(function (h) {
      if (h !== PASS_HASH) { $('#tok-lock-msg').textContent = 'Wrong password'; return; }
      try { localStorage.setItem('tok-pass', h); } catch (e) {}
      load();
    });
  });

  function init(data) {
    var synced = $('#tok-synced');
    if (synced) synced.textContent = fmtDate(data.synced);

    /* dense day axis: fill calendar gaps with zeros */
    var days = buildDense(data.days);

    statCounters(data);
    var river = riverChart($('#tok-river'), days, data.families);
    donutChart($('#tok-donut'), data.totals);
    modelBars($('#tok-bars'), data.models);
    var heat = heatmap($('#tok-heat'), data.days);
    rainEgg(data);

    var redraw = debounce(function () { river(); heat(); }, 120);
    window.addEventListener('resize', redraw);
    window.addEventListener('themechange', redraw);
  }

  function buildDense(sparse) {
    var byDate = {};
    sparse.forEach(function (d) { byDate[d.d] = d; });
    var first = new Date(sparse[0].d + 'T00:00:00');
    var last = new Date(sparse[sparse.length - 1].d + 'T00:00:00');
    var out = [];
    for (var t = first.getTime(); t <= last.getTime(); t += 864e5) {
      var key = new Date(t).toISOString().slice(0, 10);
      out.push(byDate[key] || { d: key, f: {}, cost: 0 });
    }
    return out;
  }

  /* ---------- stat count-ups ---------- */
  function statCounters(data) {
    var t = data.totals;
    var hit = (t.cr / (t.in + t.cc + t.cr)) * 100;
    var targets = {
      total: { v: t.tok || (t.in + t.out + t.cc + t.cr), f: fmt },
      hit:   { v: hit, f: function (n) { return n.toFixed(1) + '%'; } },
      value: { v: t.cost, f: fmtUsd },
      out:   { v: t.out, f: fmt }
    };
    var ran = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting || ran) return;
        ran = true;
        io.disconnect();
        Object.keys(targets).forEach(function (k) {
          var el = $('[data-stat="' + k + '"]');
          var tg = targets[k], t0 = performance.now();
          (function tick(now) {
            var p = Math.min(1, (now - t0) / 1500);
            var e = 1 - Math.pow(1 - p, 3);
            el.textContent = tg.f(tg.v * e);
            if (p < 1) requestAnimationFrame(tick);
          })(t0);
        });
      });
    }, { threshold: 0.4 });
    io.observe($('#tok-stats'));
  }

  /* ---------- the token river (streamgraph) ---------- */
  function riverChart(canvas, days, families) {
    var readout = $('#tok-river-readout');
    var legend = $('#tok-legend');
    var fams = families.filter(function (f) {
      return days.some(function (d) { return d.f[f]; });
    });
    legend.innerHTML = fams.map(function (f) {
      return '<span><i style="background:' + FAM_COLOR[f] + '"></i>' + (FAM_LABEL[f] || f) + '</span>';
    }).join('');

    var hoverI = -1, progress = 0, started = false;

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      var pad = 6, n = days.length;
      var max = 0;
      days.forEach(function (d) {
        var s = 0;
        fams.forEach(function (f) { s += d.f[f] ? d.f[f][0] : 0; });
        max = Math.max(max, s);
      });
      if (!max) return;

      var x = function (i) { return pad + (i / (n - 1)) * (W - 2 * pad); };
      var yScale = (H - 28) / max;

      /* stacked, centered (silhouette) */
      var tops = fams.map(function () { return []; });
      var bots = fams.map(function () { return []; });
      for (var i = 0; i < n; i++) {
        var total = 0;
        fams.forEach(function (f) { total += days[i].f[f] ? days[i].f[f][0] : 0; });
        var y0 = (H - 14) / 2 + (total * yScale) / 2; /* bottom of silhouette */
        var acc = 0;
        for (var k = 0; k < fams.length; k++) {
          var v = days[i].f[fams[k]] ? days[i].f[fams[k]][0] : 0;
          bots[k].push(y0 - acc * yScale);
          acc += v;
          tops[k].push(y0 - acc * yScale);
        }
      }

      var upto = Math.max(2, Math.floor(n * progress));

      for (var k2 = fams.length - 1; k2 >= 0; k2--) {
        ctx.beginPath();
        smoothPath(ctx, tops[k2], x, upto, false);
        smoothPath(ctx, bots[k2], x, upto, true);
        ctx.closePath();
        ctx.fillStyle = FAM_COLOR[fams[k2]];
        ctx.globalAlpha = 0.82;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* hover hairline */
      if (hoverI >= 0 && hoverI < upto) {
        ctx.strokeStyle = css('--ink');
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x(hoverI), 6);
        ctx.lineTo(x(hoverI), H - 16);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      /* month ticks */
      ctx.fillStyle = css('--gray-mute');
      ctx.font = '10px ' + css('--mono');
      for (var m = 0; m < n; m++) {
        if (days[m].d.slice(8) === '01' || m === 0) {
          ctx.fillText(fmtDate(days[m].d.slice(0, 7)), x(m) + 2, H - 4);
        }
      }
    }

    function smoothPath(ctx, ys, x, upto, reverse) {
      var idx = [];
      for (var i = 0; i < upto; i++) idx.push(i);
      if (reverse) idx.reverse();
      idx.forEach(function (i, j) {
        if (j === 0 && !reverse) ctx.moveTo(x(i), ys[i]);
        else if (j === 0) ctx.lineTo(x(i), ys[i]);
        else {
          var pi = idx[j - 1];
          var cx = (x(pi) + x(i)) / 2;
          ctx.bezierCurveTo(cx, ys[pi], cx, ys[i], x(i), ys[i]);
        }
      });
    }

    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      var i = Math.round(((e.clientX - r.left) / r.width) * (days.length - 1));
      i = Math.max(0, Math.min(days.length - 1, i));
      if (i === hoverI) return;
      hoverI = i;
      var d = days[i], tot = 0;
      Object.keys(d.f).forEach(function (f) { tot += d.f[f][0]; });
      readout.textContent = tot
        ? fmtDate(d.d) + ': ' + fmt(tot) + ' tokens, ' + fmtUsd(d.cost)
        : fmtDate(d.d) + ': quiet day';
      draw();
    });
    canvas.addEventListener('mouseleave', function () {
      hoverI = -1; readout.innerHTML = '&nbsp;'; draw();
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting || started) return;
        started = true;
        io.disconnect();
        var t0 = performance.now();
        (function tick(now) {
          progress = Math.min(1, (now - t0) / 1600);
          progress = 1 - Math.pow(1 - progress, 2);
          draw();
          if (progress < 1) requestAnimationFrame(tick);
        })(t0);
      });
    }, { threshold: 0.25 });
    io.observe(canvas);

    return draw;
  }

  /* ---------- cache donut ---------- */
  function donutChart(svg, t) {
    var order = ['cr', 'cc', 'out', 'in'];
    var vals = { cr: t.cr, cc: t.cc, out: t.out, in: t.in };
    var sum = order.reduce(function (a, k) { return a + vals[k]; }, 0);
    var hit = ((t.cr / (t.in + t.cc + t.cr)) * 100).toFixed(1);
    var R = 88, C = 2 * Math.PI * R;
    var ns = 'http://www.w3.org/2000/svg';
    var acc = 0;

    order.forEach(function (k) {
      var frac = vals[k] / sum;
      var seg = document.createElementNS(ns, 'circle');
      seg.setAttribute('cx', 120); seg.setAttribute('cy', 120); seg.setAttribute('r', R);
      seg.setAttribute('fill', 'none');
      seg.setAttribute('stroke', SEG_COLOR[k]);
      seg.setAttribute('stroke-width', 26);
      seg.setAttribute('stroke-dasharray', Math.max(0, frac * C - 2.5) + ' ' + C);
      seg.setAttribute('transform', 'rotate(' + (acc * 360 - 90) + ' 120 120)');
      seg.setAttribute('class', 'donut-seg');
      seg.dataset.label = SEG_LABEL[k];
      seg.dataset.value = fmt(vals[k]) + ', ' + (frac * 100).toFixed(1) + '%';
      svg.appendChild(seg);
      acc += frac;
    });

    var big = textEl(ns, 120, 114, 'donut-big mono');
    var small = textEl(ns, 120, 140, 'donut-small mono');
    big.textContent = hit + '%';
    small.textContent = 'cache hit';
    svg.appendChild(big); svg.appendChild(small);

    svg.addEventListener('mouseover', function (e) {
      if (!e.target.dataset.label) return;
      big.textContent = e.target.dataset.value.split(', ')[1];
      small.textContent = e.target.dataset.label + ': ' + e.target.dataset.value.split(', ')[0];
    });
    svg.addEventListener('mouseleave', function () {
      big.textContent = hit + '%';
      small.textContent = 'cache hit';
    });

    function textEl(ns, x, y, cls) {
      var el = document.createElementNS(ns, 'text');
      el.setAttribute('x', x); el.setAttribute('y', y);
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('class', cls);
      return el;
    }
  }

  /* ---------- model bars ---------- */
  function modelBars(host, models) {
    var top = models.slice().sort(function (a, b) { return b.cost - a.cost; });
    var max = top[0].cost;
    top.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'tok-bar-row';
      row.innerHTML =
        '<span class="tok-bar-name mono">' + (FAM_LABEL[m.name] || m.name) + '</span>' +
        '<span class="tok-bar-track"><i style="background:' + (FAM_COLOR[m.name] || '#8a9492') + '" data-w="' + (m.cost / max * 100) + '"></i></span>' +
        '<span class="tok-bar-val mono">' + fmtUsd(m.cost) + ', ' + fmt(m.tok) + '</span>';
      host.appendChild(row);
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.disconnect();
        host.querySelectorAll('.tok-bar-track i').forEach(function (bar, i) {
          setTimeout(function () { bar.style.width = bar.dataset.w + '%'; }, i * 90);
        });
      });
    }, { threshold: 0.4 });
    io.observe(host);
  }

  /* ---------- calendar heatmap ---------- */
  function heatmap(svg, sparse) {
    var readout = $('#tok-heat-readout');
    var byDate = {};
    sparse.forEach(function (d) {
      var tot = 0;
      Object.keys(d.f).forEach(function (f) { tot += d.f[f][0]; });
      byDate[d.d] = { tok: tot, cost: d.cost };
    });

    function draw() {
      svg.innerHTML = '';
      var ns = 'http://www.w3.org/2000/svg';
      var first = new Date(sparse[0].d + 'T00:00:00');
      var last = new Date(sparse[sparse.length - 1].d + 'T00:00:00');
      /* align to Monday */
      var start = new Date(first);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      var cell = 13, gap = 3, col = 0;
      var maxLog = 0;
      Object.keys(byDate).forEach(function (k) {
        maxLog = Math.max(maxLog, Math.log10(1 + byDate[k].tok));
      });
      var accent = css('--accent');
      var lastMonth = '';
      for (var t = start.getTime(); t <= last.getTime(); ) {
        for (var row = 0; row < 7 && t <= last.getTime(); row++, t += 864e5) {
          var dt = new Date(t);
          var key = dt.toISOString().slice(0, 10);
          var rec = byDate[key];
          var r = document.createElementNS(ns, 'rect');
          r.setAttribute('x', col * (cell + gap));
          r.setAttribute('y', 14 + row * (cell + gap));
          r.setAttribute('width', cell); r.setAttribute('height', cell);
          r.setAttribute('rx', 3);
          if (rec) {
            var a = 0.12 + 0.88 * Math.pow(Math.log10(1 + rec.tok) / maxLog, 2.2);
            r.setAttribute('fill', accent);
            r.setAttribute('fill-opacity', a.toFixed(2));
            r.dataset.txt = fmtDate(key) + ': ' + fmt(rec.tok) + ' tokens, ' + fmtUsd(rec.cost);
          } else {
            r.setAttribute('fill', css('--line'));
            r.setAttribute('fill-opacity', dt < first ? 0 : 0.45);
            if (dt >= first) r.dataset.txt = fmtDate(key) + ': quiet day';
          }
          r.setAttribute('class', 'heat-cell');
          svg.appendChild(r);
          /* month label at each month's first appearance */
          var mo = key.slice(0, 7);
          if (mo !== lastMonth && key.slice(8) <= '07' && row === 0) {
            lastMonth = mo;
            var tx = document.createElementNS(ns, 'text');
            tx.setAttribute('x', col * (cell + gap));
            tx.setAttribute('y', 9);
            tx.setAttribute('class', 'heat-month mono');
            tx.textContent = mo.slice(5);
            svg.appendChild(tx);
          }
        }
        col++;
      }
      svg.setAttribute('width', col * (cell + gap));
      svg.setAttribute('height', 14 + 7 * (cell + gap));
    }

    svg.addEventListener('mouseover', function (e) {
      if (e.target.dataset && e.target.dataset.txt) readout.textContent = e.target.dataset.txt;
    });
    svg.addEventListener('mouseleave', function () { readout.innerHTML = '&nbsp;'; });

    draw();
    return draw;
  }

  /* ---------- the egg: token 即生产力 ---------- */
  var GLYPHS = ['▁the', 'ing', '▁of', 'tion', '▁re', '▁to', 'er', '▁and', '▁in', 'est',
    '▁co', 'de', '▁ag', 'ent', '▁token', '<eos>', 'λ', '→', '{ }', '✳', '生', '产', '力'];
  var PALETTE = ['#8aa6b5', '#67828f', '#9fae9b', '#a9a3b8', '#c2b8aa'];

  function tokenRain() {
    var W = window.innerWidth;
    for (var i = 0; i < 90; i++) {
      var el = document.createElement('span');
      el.className = 'token-drop mono';
      el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      el.style.left = Math.random() * W + 'px';
      el.style.color = PALETTE[i % PALETTE.length];
      el.style.fontSize = (10 + Math.random() * 8) + 'px';
      document.body.appendChild(el);
      el.animate([
        { transform: 'translateY(-30px) rotate(0deg)', opacity: 0 },
        { opacity: 0.95, offset: 0.1 },
        { transform: 'translateY(' + (window.innerHeight + 60) + 'px) rotate(' + (Math.random() * 60 - 30) + 'deg)', opacity: 0.5 }
      ], {
        duration: 2200 + Math.random() * 2600,
        delay: Math.random() * 900,
        easing: 'cubic-bezier(0.3, 0, 0.6, 1)',
        fill: 'forwards'
      });
      (function (node) { setTimeout(function () { node.remove(); }, 6200); })(el);
    }
  }

  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function rainEgg(data) {
    var egg = $('#tok-egg');
    if (!egg) return;
    var clicks = 0, timer = null;
    egg.addEventListener('click', function () {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(function () { clicks = 0; }, 2200);
      if (clicks >= 3) {
        clicks = 0;
        tokenRain();
        toast('✳ token 即生产力: tokens are productivity');
      }
    });
    /* expose for the hidden terminal */
    window.__tokens = {
      rain: tokenRain,
      stats: function () {
        var t = data.totals;
        var hit = ((t.cr / (t.in + t.cc + t.cr)) * 100).toFixed(1);
        return fmt(t.in + t.out + t.cc + t.cr) + ' tokens, cache hit ' + hit +
          '%, ' + fmtUsd(t.cost) + ' equivalent API value, synced ' + fmtDate(data.synced);
      }
    };
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
})();
