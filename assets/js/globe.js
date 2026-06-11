/* A hand-drawn-style wireframe Earth: orthographic projection, slow spin,
   two small satellites on inclined orbits. Drag to rotate.
   window.__globe exposes warp(). */
(function () {
  'use strict';

  var canvas = document.getElementById('globe');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var RAD = Math.PI / 180;
  var TILT = -23.4 * RAD; // Earth's obliquity, for charm

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BASE_SPEED = reduced ? 0 : 0.10; // rad / s

  var rot = 0;
  var vel = 0;             // drag inertia
  var warpT = 0;           // seconds of warp left
  var dragging = false;
  var lastX = 0;
  var lastT = performance.now();
  var t = 0;               // animation clock (s)

  var W = 0, H = 0, CX = 0, CY = 0, R = 0;

  var colors = {};
  function readColors() {
    var s = getComputedStyle(document.documentElement);
    colors.line  = s.getPropertyValue('--globe-line').trim()  || 'rgba(37,42,44,0.15)';
    colors.limb  = s.getPropertyValue('--globe-limb').trim()  || 'rgba(37,42,44,0.36)';
    colors.arc   = s.getPropertyValue('--globe-arc').trim()   || 'rgba(103,130,143,0.55)';
    colors.pin   = s.getPropertyValue('--globe-pin').trim()   || '#7e9aad';
    colors.label = s.getPropertyValue('--globe-label').trim() || '#65706f';
    colors.land  = s.getPropertyValue('--globe-land').trim()  || 'rgba(103,130,143,0.5)';
    colors.moon  = s.getPropertyValue('--paper').trim()       || '#fdfefd';
  }
  readColors();
  window.addEventListener('themechange', readColors);

  function vec(lat, lon) {
    var la = lat * RAD, lo = lon * RAD;
    return {
      x: Math.cos(la) * Math.sin(lo),
      y: Math.sin(la),
      z: Math.cos(la) * Math.cos(lo)
    };
  }

  // rotate around Y by rot, then tilt around X; viewer looks down +z
  function view(v) {
    var c = Math.cos(rot), s = Math.sin(rot);
    var x = v.x * c + v.z * s;
    var z = v.z * c - v.x * s;
    var ct = Math.cos(TILT), st = Math.sin(TILT);
    var y = v.y * ct - z * st;
    var z2 = v.y * st + z * ct;
    return { x: x, y: y, z: z2 };
  }

  // tilt only — satellites orbit independently of the surface spin
  function tiltOnly(v) {
    var ct = Math.cos(TILT), st = Math.sin(TILT);
    return { x: v.x, y: v.y * ct - v.z * st, z: v.y * st + v.z * ct };
  }

  function screen(p, scale) {
    var k = R * (scale || 1);
    return { x: CX + p.x * k, y: CY - p.y * k };
  }

  function polyline(points) {
    var open = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p && p.z > 0.001) {
        var s = screen(p, p.scale);
        if (!open) { ctx.moveTo(s.x, s.y); open = true; }
        else ctx.lineTo(s.x, s.y);
      } else {
        open = false;
      }
    }
  }

  function drawGraticule() {
    ctx.beginPath();
    var lat, lon, pts;
    for (lat = -60; lat <= 60; lat += 20) {           // parallels
      pts = [];
      for (lon = 0; lon <= 360; lon += 4) pts.push(view(vec(lat, lon)));
      polyline(pts);
    }
    for (lon = 0; lon < 360; lon += 15) {             // meridians
      pts = [];
      for (lat = -90; lat <= 90; lat += 4) pts.push(view(vec(lat, lon)));
      polyline(pts);
    }
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();                                   // the limb
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = colors.limb;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  /* ----- continents as a dot-matrix, from a 1° land mask ----- */
  var landDots = null;
  (function loadLand() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/assets/data/land.json?v=1');
    xhr.onload = function () {
      if (xhr.status !== 200) return;
      var mask = JSON.parse(xhr.responseText);
      // hex rows -> bit lookup: land(latIdx 0..179 from -90, lonIdx 0..359 from -180)
      var rows = mask.rows.map(function (hex) {
        var bytes = new Uint8Array(45);
        for (var i = 0; i < 45; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        return bytes;
      });
      function isLand(lat, lon) {
        var li = Math.floor(lat + 90), lo = Math.floor(lon + 180);
        if (li < 0 || li > 179) return false;
        lo = ((lo % 360) + 360) % 360;
        return (rows[li][lo >> 3] & (1 << (lo & 7))) !== 0;
      }
      // fixed surface dots, lon spacing widened by 1/cos(lat) so density is even
      var STEP = 2.6;
      landDots = [];
      for (var lat = -84; lat <= 84; lat += STEP) {
        var lonStep = STEP / Math.cos(lat * RAD);
        for (var lon = -180; lon < 180; lon += lonStep) {
          if (isLand(lat, lon)) landDots.push(vec(lat, lon));
        }
      }
    };
    xhr.send();
  })();

  function drawLand() {
    if (!landDots) return;
    ctx.fillStyle = colors.land;
    for (var i = 0; i < landDots.length; i++) {
      var p = view(landDots[i]);
      if (p.z <= 0.01) continue;
      var s = screen(p);
      ctx.globalAlpha = Math.min(1, p.z * 1.8);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ----- places I've been, and the flights between them ----- */
  var CITIES = {
    beijing:     { lat: 39.90,  lon: 116.41, label: 'beijing' },
    changsha:    { lat: 28.23,  lon: 112.97, label: 'changsha' },
    sandiego:    { lat: 32.72,  lon: -117.16, label: 'san diego' },
    losangeles:  { lat: 34.05,  lon: -118.24, label: 'los angeles' },
    singapore:   { lat: 1.35,   lon: 103.82, label: 'singapore' },
    addis:       { lat: 9.03,   lon: 38.74,  label: 'addis ababa' },
    saopaulo:    { lat: -23.55, lon: -46.63, label: 'são paulo' },
    salvador:    { lat: -12.97, lon: -38.50, label: 'salvador' }
  };
  var ROUTES = [
    ['beijing', 'changsha'],
    ['beijing', 'singapore'],
    ['beijing', 'addis'],      // ethiopian airlines, the long way to brazil
    ['addis', 'saopaulo'],
    ['saopaulo', 'salvador'],
    ['beijing', 'losangeles'], // the exchange semester
    ['losangeles', 'sandiego']
  ];

  function slerp(a, b, f) {
    var dot = a.x * b.x + a.y * b.y + a.z * b.z;
    dot = Math.max(-1, Math.min(1, dot));
    var om = Math.acos(dot);
    if (om < 1e-6) return a;
    var sa = Math.sin((1 - f) * om) / Math.sin(om);
    var sb = Math.sin(f * om) / Math.sin(om);
    return { x: a.x * sa + b.x * sb, y: a.y * sa + b.y * sb, z: a.z * sa + b.z * sb };
  }

  function drawRoutes() {
    var i, k, key;
    // arcs, gently lifted off the surface like real flight paths
    ctx.strokeStyle = colors.arc;
    ctx.lineWidth = 1;
    for (i = 0; i < ROUTES.length; i++) {
      var a = vec(CITIES[ROUTES[i][0]].lat, CITIES[ROUTES[i][0]].lon);
      var b = vec(CITIES[ROUTES[i][1]].lat, CITIES[ROUTES[i][1]].lon);
      var pts = [];
      for (k = 0; k <= 36; k++) {
        var f = k / 36;
        var p = view(slerp(a, b, f));
        p.scale = 1 + 0.07 * Math.sin(Math.PI * f); // cruise altitude
        pts.push(p);
      }
      ctx.beginPath();
      polyline(pts);
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // city pins + labels on the front hemisphere
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (key in CITIES) {
      var c = CITIES[key];
      var pv = view(vec(c.lat, c.lon));
      if (pv.z <= 0.02) continue;
      var sp = screen(pv);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = colors.pin;
      ctx.globalAlpha = Math.min(1, pv.z * 2.5);
      ctx.fill();
      if (pv.z > 0.3) {
        ctx.fillStyle = colors.label;
        ctx.globalAlpha = Math.min(1, (pv.z - 0.3) * 2.2);
        ctx.fillText(c.label, sp.x + 5, sp.y + 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ----- satellites: abstract companions on inclined orbits ----- */
  var SATS = [
    { radius: 1.24, incl: 58 * RAD,  phase: 0,   speed: 0.30 },
    { radius: 1.42, incl: -32 * RAD, phase: 2.4, speed: -0.20 }
  ];

  function orbitPoint(sat, theta) {
    // circle in the xz-plane, rotated around X by the orbit's inclination
    var p = { x: Math.cos(theta), y: 0, z: Math.sin(theta) };
    var ci = Math.cos(sat.incl), si = Math.sin(sat.incl);
    var v = { x: p.x, y: -p.z * si, z: p.z * ci };
    v = tiltOnly(v);
    return { x: v.x * sat.radius, y: v.y * sat.radius, z: v.z * sat.radius };
  }

  function occluded(p) {
    // hidden when behind the sphere's disk
    if (p.z >= 0) return false;
    var s = screen(p); // p already carries the orbit radius
    var dx = s.x - CX, dy = s.y - CY;
    return dx * dx + dy * dy < R * R;
  }

  function drawSatellites() {
    for (var i = 0; i < SATS.length; i++) {
      var sat = SATS[i];

      // faint dashed orbit path
      ctx.beginPath();
      var open = false;
      for (var a = 0; a <= 360; a += 3) {
        var p = orbitPoint(sat, a * RAD);
        if (!occluded(p)) {
          var s = screen(p);
          if (!open) { ctx.moveTo(s.x, s.y); open = true; }
          else ctx.lineTo(s.x, s.y);
        } else open = false;
      }
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // the satellite itself
      var speed = sat.speed * (warpT > 0 ? 8 : 1);
      var theta = sat.phase + t * speed;
      var sp = orbitPoint(sat, theta);
      if (!occluded(sp)) {
        var ss = screen(sp);
        var a2 = sp.z > 0 ? 1 : 0.45;
        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = colors.pin;
        ctx.globalAlpha = a2;
        ctx.fill();
        ctx.beginPath();                               // tiny halo ring
        ctx.arc(ss.x, ss.y, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = colors.arc;
        ctx.globalAlpha = a2 * 0.5;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ----- the moon, on a wide inclined orbit ----- */
  var MOON = { radius: 1.66, incl: 14 * RAD, phase: 1.1, speed: 0.12 };

  function drawMoon() {
    // dashed orbit path, wider dashes than the satellites'
    ctx.beginPath();
    var open = false;
    for (var a = 0; a <= 360; a += 3) {
      var p = orbitPoint(MOON, a * RAD);
      if (!occluded(p)) {
        var s = screen(p);
        if (!open) { ctx.moveTo(s.x, s.y); open = true; }
        else ctx.lineTo(s.x, s.y);
      } else open = false;
    }
    ctx.setLineDash([1, 9]);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    var speed = MOON.speed * (warpT > 0 ? 8 : 1);
    var mp = orbitPoint(MOON, MOON.phase + t * speed);
    if (occluded(mp)) return;
    var ms = screen(mp);
    var zn = mp.z / MOON.radius;             // -1 .. 1 depth
    var r = 6.2 + 1.8 * zn;                  // nearer = a touch larger
    var al = zn > 0 ? 1 : 0.5;

    ctx.globalAlpha = al;
    ctx.beginPath();                          // body, paper-toned
    ctx.arc(ms.x, ms.y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors.moon;
    ctx.fill();
    ctx.strokeStyle = colors.limb;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = colors.line;            // a few craters, hand-drawn
    ctx.lineWidth = 0.9;
    var CRATERS = [[-0.34, -0.22, 0.30], [0.28, 0.10, 0.20], [-0.05, 0.42, 0.15]];
    for (var i = 0; i < CRATERS.length; i++) {
      ctx.beginPath();
      ctx.arc(ms.x + CRATERS[i][0] * r, ms.y + CRATERS[i][1] * r, CRATERS[i][2] * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ----- pointer ripples: the space answers back ----- */
  var ripples = [];
  var lastRX = -1, lastRY = -1;

  function spawnRipple(x, y, strong) {
    if (reduced) return;
    ripples.push({ x: x, y: y, age: 0, life: strong ? 1.5 : 1.0, max: strong ? 96 : 52, a: strong ? 0.55 : 0.3 });
    if (ripples.length > 24) ripples.shift();
  }

  function drawRipples(dt) {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      rp.age += dt;
      var f = rp.age / rp.life;
      if (f >= 1) { ripples.splice(i, 1); continue; }
      var ease = 1 - Math.pow(1 - f, 3);
      var rr = 4 + ease * rp.max;
      ctx.strokeStyle = colors.arc;
      ctx.lineWidth = 1;
      ctx.globalAlpha = rp.a * (1 - f);
      ctx.beginPath();                        // flattened — a ripple in the spatial plane
      ctx.ellipse(rp.x, rp.y, rr, rr * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();                        // trailing inner ring
      ctx.ellipse(rp.x, rp.y, rr * 0.55, rr * 0.55 * 0.34, 0, 0, Math.PI * 2);
      ctx.globalAlpha = rp.a * (1 - f) * 0.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // small "+" twinkles floating around the sphere
  var MARKS = [
    { x: 0.08, y: 0.16 }, { x: 0.92, y: 0.10 }, { x: 0.95, y: 0.62 },
    { x: 0.05, y: 0.78 }, { x: 0.86, y: 0.92 }, { x: 0.13, y: 0.45 }
  ];
  function drawMarks(now) {
    ctx.strokeStyle = colors.limb;
    ctx.lineWidth = 1;
    for (var i = 0; i < MARKS.length; i++) {
      var m = MARKS[i];
      var tw = reduced ? 0.5 : 0.3 + 0.7 * Math.abs(Math.sin(now / 2400 + i * 1.7));
      var x = m.x * W, y = m.y * H, r = 3.2;
      ctx.globalAlpha = 0.5 * tw;
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (!reduced) t += dt;

    if (!dragging) {
      var speed = BASE_SPEED;
      if (warpT > 0) { speed += 5.2 * Math.min(1, warpT); warpT -= dt; }
      rot += speed * dt + vel;
      vel *= 0.94;
      if (Math.abs(vel) < 0.0001) vel = 0;
    }

    ctx.clearRect(0, 0, W, H);
    drawRipples(dt);
    drawMarks(now);
    drawGraticule();
    drawLand();
    drawRoutes();
    drawSatellites();
    drawMoon();

    requestAnimationFrame(frame);
  }

  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = W / 2; CY = H / 2;
    R = Math.min(W, H) * 0.34;
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);

  // ----- interaction -----
  canvas.style.touchAction = 'pan-y';
  function localXY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
    var p = localXY(e);
    spawnRipple(p.x, p.y, true);
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = localXY(e);
    var dxr = p.x - lastRX, dyr = p.y - lastRY;
    if (dxr * dxr + dyr * dyr > 42 * 42) {   // a quiet wake, not a wave pool
      spawnRipple(p.x, p.y, false);
      lastRX = p.x; lastRY = p.y;
    }
    if (!dragging) return;
    var dx = e.clientX - lastX;
    lastX = e.clientX;
    rot += dx * 0.005;
    vel = dx * 0.0009;
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.__globe = {
    warp: function () { warpT = 2.6; }
  };

  requestAnimationFrame(frame);
})();
