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
    drawMarks(now);
    drawGraticule();
    drawSatellites();

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
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
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
