/* Interactions: scroll reveals, nav state, contribution wave, city chips,
   and the easter eggs — spark confetti, Claude mode, Konami warp, terminal. */
(function () {
  'use strict';

  function $(s, p) { return (p || document).querySelector(s); }
  function $$(s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); }

  /* ---------- footer year ---------- */
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- live durations for "Present" roles ---------- */
  $$('.xp-dur[data-start]').forEach(function (el) {
    var p = el.dataset.start.split('-');
    var now = new Date();
    var months = (now.getFullYear() - +p[0]) * 12 + (now.getMonth() + 1 - +p[1]) + 1;
    if (months < 1) months = 1;
    var y = Math.floor(months / 12), m = months % 12;
    el.textContent = y
      ? y + ' yr' + (y > 1 ? 's' : '') + (m ? ' ' + m + ' mo' + (m > 1 ? 's' : '') : '')
      : m + ' mo' + (m > 1 ? 's' : '');
  });

  /* ---------- nav scrolled state ---------- */
  var nav = $('#nav');
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- scroll reveals ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- toast ---------- */
  var toastEl = $('#toast');
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------- spark confetti ---------- */
  var SPARK_SVG = '<svg viewBox="0 0 32 32" fill="none"><path d="M16 3v8.5M16 20.5V29M3 16h8.5M20.5 16H29M6.8 6.8l6 6M19.2 19.2l6 6M25.2 6.8l-6 6M12.8 19.2l-6 6" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>';
  var PALETTE = ['#8aa6b5', '#67828f', '#9fae9b', '#a9a3b8', '#c2b8aa'];
  function burst(x, y, n) {
    for (var i = 0; i < (n || 26); i++) {
      var el = document.createElement('div');
      el.className = 'spark-bit';
      el.innerHTML = SPARK_SVG;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.color = PALETTE[i % PALETTE.length];
      document.body.appendChild(el);
      var ang = Math.random() * Math.PI * 2;
      var dist = 60 + Math.random() * 160;
      var dx = Math.cos(ang) * dist;
      var dy = Math.sin(ang) * dist + 120;
      el.animate([
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + (dx - 7) + 'px,' + (dy - 7) + 'px) scale(0.3) rotate(' + (Math.random() > 0.5 ? '' : '-') + '540deg)', opacity: 0 }
      ], { duration: 1100 + Math.random() * 700, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' });
      (function (node) { setTimeout(function () { node.remove(); }, 2000); })(el);
    }
  }

  /* ---------- egg 1: click the spark 5 times ---------- */
  var brand = $('#brand');
  var clicks = 0, clickTimer = null;
  if (brand) {
    brand.addEventListener('click', function (e) {
      clicks++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(function () { clicks = 0; }, 2500);
      if (clicks >= 5) {
        clicks = 0;
        e.preventDefault();
        var r = brand.getBoundingClientRect();
        burst(r.left + r.height / 2, r.top + r.height / 2, 32);
        toast('✳ you found the spark');
      }
    });
  }

  /* ---------- egg 2: type "claude" ---------- */
  function setClaude(on, quiet) {
    document.documentElement.classList.toggle('claude', on);
    try { localStorage.setItem('theme', on ? 'claude' : 'ivory'); } catch (e) {}
    window.dispatchEvent(new Event('themechange'));
    if (!quiet) toast(on ? 'night mode, easy on the eyes ☾' : 'back to the mist ☀');
  }
  var typed = '';
  window.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key && e.key.length === 1) {
      typed = (typed + e.key.toLowerCase()).slice(-12);
      if (typed.slice(-6) === 'claude') {
        typed = '';
        setClaude(!document.documentElement.classList.contains('claude'));
      }
    }
  });

  /* ---------- egg 3: Konami code -> globe warp ---------- */
  var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  var kIdx = 0;
  window.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    kIdx = (e.key === KONAMI[kIdx]) ? kIdx + 1 : (e.key === KONAMI[0] ? 1 : 0);
    if (kIdx === KONAMI.length) {
      kIdx = 0;
      if (window.__globe) window.__globe.warp();
      toast('✦ warp speed engaged');
      var w = window.innerWidth;
      for (var i = 0; i < 4; i++) {
        setTimeout(function () { burst(Math.random() * w, 80 + Math.random() * 120, 14); }, i * 220);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  /* ---------- egg 4: the ` terminal ---------- */
  var term = null, termOut = null, termIn = null;
  var FILES = {
    'about.txt': 'Zixuan (Alex) Wang, Mathematics and Physics undergraduate at Tsinghua, with a minor in AI.\nI study LLM agents, agentic reinforcement learning, and personalization.\nPreviously a research assistant at CMU, advised by Prof. Andrea Zanette.',
    'research.txt': '1. Reliable and scalable LLM agents\n2. Learning from interaction and harness adaptation\n3. Memory, personalization, and agent evaluation',
    'secrets.txt': 'nice try. the real secrets are the friends we made along the way ✳'
  };
  var SECTIONS = ['about', 'research', 'education', 'experience', 'research-projects', 'blogs', 'course-projects', 'tokens'];

  function buildTerm() {
    term = document.createElement('div');
    term.className = 'term';
    term.innerHTML =
      '<div class="term-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
      '<span class="term-title">alex@earth: ~/wannabeyourfriend</span></div>' +
      '<div class="term-out"></div>' +
      '<div class="term-in"><span class="ps1">alex@earth:~$</span><input type="text" autocomplete="off" spellcheck="false" aria-label="terminal input"></div>';
    document.body.appendChild(term);
    termOut = $('.term-out', term);
    termIn = $('input', term);
    print('<span class="ok">welcome to the hidden shell.</span> type <span class="accent">help</span> to look around.\n');
    termIn.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { toggleTerm(false); return; }
      if (e.key === 'Enter') {
        var cmd = termIn.value.trim();
        termIn.value = '';
        if (cmd) run(cmd);
      }
      e.stopPropagation();
    });
    term.addEventListener('click', function () { termIn.focus(); });
  }

  function print(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    termOut.appendChild(div);
    termOut.scrollTop = termOut.scrollHeight;
  }

  function run(raw) {
    print('<span class="dim">alex@earth:~$ ' + raw.replace(/</g, '&lt;') + '</span>');
    var parts = raw.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var arg = parts.slice(1).join(' ').toLowerCase();
    switch (cmd) {
      case 'help':
        print('available commands:\n' +
          '  <span class="accent">whoami</span>          who is this person\n' +
          '  <span class="accent">ls</span>              list files & sections\n' +
          '  <span class="accent">cat</span> &lt;file&gt;      read a file\n' +
          '  <span class="accent">go</span> &lt;section&gt;    scroll to a section\n' +
          '  <span class="accent">open</span> github|cv|linkedin|mail\n' +
          '  <span class="accent">globe</span> warp      give the planet a push\n' +
          '  <span class="accent">tokens</span>          how much have the agents read\n' +
          '  <span class="accent">claude</span>          toggle night mode\n' +
          '  <span class="accent">clear</span>, <span class="accent">exit</span>\n');
        break;
      case 'whoami':
        print('Zixuan (Alex) Wang, undergraduate at Tsinghua University.\nInterested in building reliable and scalable LLM agents.\nsaxophone on weekends. 🎷\n');
        break;
      case 'ls':
        print('<span class="ok">' + Object.keys(FILES).join('  ') + '</span>\nsections/: ' + SECTIONS.join('  ') + '\n');
        break;
      case 'cat':
        print(FILES[arg] ? FILES[arg] + '\n' : 'cat: ' + (arg || '?') + ': no such file\n');
        break;
      case 'go':
        if (SECTIONS.indexOf(arg) >= 0) {
          document.getElementById(arg).scrollIntoView({ behavior: 'smooth' });
          print('navigating to <span class="accent">#' + arg + '</span>…\n');
        } else print('go where? try: go ' + SECTIONS.join(' | ') + '\n');
        break;
      case 'open':
        var urls = {
          github: 'https://github.com/wannabeyourfriend',
          cv: $('.nav-cta a') ? $('.nav-cta a').href : '#',
          linkedin: 'https://www.linkedin.com/in/zixuan-wang-6b6b233b2',
          mail: 'mailto:zixuan.alex.wang@outlook.com'
        };
        if (urls[arg]) { window.open(urls[arg], '_blank'); print('opening ' + arg + ' ↗\n'); }
        else print('open what? github | cv | linkedin | mail\n');
        break;
      case 'globe':
        if (arg === 'warp') { if (window.__globe) window.__globe.warp(); print('<span class="ok">✦ warp speed engaged</span>\n'); }
        else print('usage: globe warp\n');
        break;
      case 'claude':
        setClaude(!document.documentElement.classList.contains('claude'), true);
        print('<span class="ok">theme toggled ✳</span>\n');
        break;
      case 'tokens':
        if (window.__tokens) {
          print('<span class="ok">' + window.__tokens.stats() + '</span>');
          print('<span class="accent">token 即生产力</span>: tokens are productivity ✳\n');
          window.__tokens.rain();
        } else print('telemetry is still loading. try again in a second\n');
        break;
      case 'sudo':
        print('<span class="accent">permission denied:</span> this incident will be reported to absolutely no one.\n');
        break;
      case 'echo':
        print(parts.slice(1).join(' ').replace(/</g, '&lt;') + '\n');
        break;
      case 'clear':
        termOut.innerHTML = '';
        break;
      case 'exit':
        toggleTerm(false);
        break;
      default:
        print('command not found: ' + cmd.replace(/</g, '&lt;') + '. try <span class="accent">help</span>\n');
    }
  }

  function toggleTerm(open) {
    if (!term) buildTerm();
    var willOpen = open !== undefined ? open : !term.classList.contains('open');
    term.classList.toggle('open', willOpen);
    if (willOpen) setTimeout(function () { termIn.focus(); }, 250);
    else termIn.blur();
  }

  window.addEventListener('keydown', function (e) {
    if (e.key !== '`') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleTerm();
  });

  /* ---------- a note for fellow travelers ---------- */
  if (window.console && console.log) {
    console.log(
      '%c✳%c hello, curious one.\n' +
      'eggs: click my name ×5, type "claude", konami code, press `, §07 hides a rain\n' +
      'source: https://github.com/wannabeyourfriend/wannabeyourfriend.github.io',
      'color:#8aa6b5;font-size:28px;', 'color:inherit;font-size:12px;'
    );
  }
})();
