/* A hand-drawn-style wireframe Earth: orthographic projection, slow spin,
   two small satellites on inclined orbits. Drag to rotate.
   window.__globe exposes warp(). */
(function () {
  'use strict';

  var canvas = document.getElementById('globe');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var RAD = Math.PI / 180;
  var TILT = 23.4 * RAD; // Earth's obliquity; positive tips the north pole toward you

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
      var vis = false;
      if (p) {
        if (p.z > 0.001) vis = true;
        else if (p.scale > 1) {
          // lifted off the surface: still visible past the limb until the
          // earth's disk actually occludes it
          var sx = p.x * p.scale, sy = p.y * p.scale;
          vis = sx * sx + sy * sy > 1.0002;
        }
      }
      if (vis) {
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
      var li = p.x * sunView.x + p.y * sunView.y + p.z * sunView.z;
      var day = Math.max(0, Math.min(1, li * 6 + 0.5));   // soft twilight band
      ctx.globalAlpha = Math.min(1, p.z * 1.8) * (0.42 + 0.58 * day);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ----- the sun: its true direction, from the actual UTC time -----
     Low-precision solar ephemeris (good to ~0.01°): mean longitude and
     anomaly since J2000 give the ecliptic longitude, hence declination and
     the equation of time; the subsolar point follows from the wall clock.
     So the night side you see IS tonight's night side. */
  var sunModel = { x: 0, y: 0, z: 1 };
  var sunView  = { x: 0, y: 0, z: 1 };

  function updateSun() {
    var now = new Date();
    var n = now.getTime() / 86400000 - 10957.5;                 // days since J2000.0
    var L = (((280.460 + 0.9856474 * n) % 360) + 360) % 360;    // mean longitude (deg)
    var g = (357.528 + 0.9856003 * n) * RAD;                    // mean anomaly
    var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    var eps = 23.439 * RAD;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));         // declination
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    var eot = L * RAD - ra;                                     // equation of time
    eot = Math.atan2(Math.sin(eot), Math.cos(eot));
    var utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    var lonSS = -(utcH - 12) * 15 * RAD - eot;                  // subsolar longitude
    sunModel = vec(dec / RAD, lonSS / RAD);
  }
  updateSun();
  setInterval(updateSun, 60000);

  // points on a geodesic circle of angular radius psi around model vector c
  function geoCircle(c, psi, segs) {
    var ref = Math.abs(c.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    var u = { x: c.y * ref.z - c.z * ref.y, y: c.z * ref.x - c.x * ref.z, z: c.x * ref.y - c.y * ref.x };
    var ul = Math.hypot(u.x, u.y, u.z);
    u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
    var w = { x: c.y * u.z - c.z * u.y, y: c.z * u.x - c.x * u.z, z: c.x * u.y - c.y * u.x };
    var cp = Math.cos(psi), sp = Math.sin(psi), pts = [];
    for (var k = 0; k <= segs; k++) {
      var ph = (k / segs) * Math.PI * 2;
      var ca = Math.cos(ph), sa = Math.sin(ph);
      pts.push(view({
        x: c.x * cp + (u.x * ca + w.x * sa) * sp,
        y: c.y * cp + (u.y * ca + w.y * sa) * sp,
        z: c.z * cp + (u.z * ca + w.z * sa) * sp
      }));
    }
    return pts;
  }

  // a fixed stipple grid for shading the night hemisphere
  var nightDots = [];
  (function () {
    var STEP = 4.5;
    for (var lat = -87; lat <= 87; lat += STEP) {
      var ls = STEP / Math.cos(lat * RAD);
      for (var lon = -180; lon < 180; lon += ls) nightDots.push(vec(lat, lon));
    }
  })();

  function drawDayNight() {
    // night side, stippled
    ctx.fillStyle = colors.label;
    for (var i = 0; i < nightDots.length; i++) {
      var p = view(nightDots[i]);
      if (p.z <= 0.01) continue;
      var li = p.x * sunView.x + p.y * sunView.y + p.z * sunView.z;
      if (li >= 0) continue;
      var s = screen(p);
      ctx.globalAlpha = 0.10 * Math.min(1, -li * 8) * Math.min(1, p.z * 2);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // the terminator: the great circle 90° from the subsolar point
    ctx.beginPath();
    polyline(geoCircle(sunModel, Math.PI / 2, 72));
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = colors.limb;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
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
    { radius: 1.13, incl: 0, phase: 0,   speed: 0.30 },
    { radius: 1.21, incl: 0, phase: 2.4, speed: -0.20 }
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

  /* ----- the moon: a circular display orbit, dot-matrix -----
     Keep the Moon/Earth size ratio, but compress the orbit for the page.
     The orbit faces the viewer so its path is circular on screen. */
  var M_RATIO = 0.2727;
  var M_ORBIT = 1.6; // earth radii; enough clearance for the moon's disk
  var M_SPEED = reduced ? 0 : 0.08;

  var mcv = document.createElement('canvas');
  mcv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:40;';
  mcv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(mcv);
  var mctx = mcv.getContext('2d');
  var MW = 0, MH = 0;
  function mresize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    MW = window.innerWidth; MH = window.innerHeight;
    mcv.width = Math.round(MW * dpr);
    mcv.height = Math.round(MH * dpr);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  mresize();
  window.addEventListener('resize', mresize);

  // near-side maria as spherical caps: [lat, lon, angular radius°]
  var MARIA = [
    [32.8, -15.6, 16],   // imbrium
    [28.0,  17.5, 11],   // serenitatis
    [8.5,   31.4, 13],   // tranquillitatis
    [-7.8,  51.3,  9],   // fecunditatis
    [17.0,  59.1,  8],   // crisium
    [-21.3, -16.6, 10],  // nubium
    [-24.4, -38.6,  7],  // humorum
    [18.4, -57.4, 21],   // oceanus procellarum
    [56.0,   1.4,  9],   // frigoris (east half)
    [54.0, -35.0,  8]    // frigoris (west half)
  ].map(function (m) { return { v: vec(m[0], m[1]), cos: Math.cos(m[2] * RAD) }; });

  var moonDots = [];
  (function () {
    var STEP = 7;
    for (var lat = -83; lat <= 83; lat += STEP) {
      var ls = STEP / Math.cos(lat * RAD);
      for (var lon = -180; lon < 180; lon += ls) {
        var v = vec(lat, lon);
        var mare = false;
        for (var i = 0; i < MARIA.length; i++) {
          if (v.x * MARIA[i].v.x + v.y * MARIA[i].v.y + v.z * MARIA[i].v.z > MARIA[i].cos) { mare = true; break; }
        }
        moonDots.push({ v: v, mare: mare });
      }
    }
  })();

  var moonTh = 2.4;   // angle around the circular display orbit

  function drawMoonLayer() {
    mctx.clearRect(0, 0, MW, MH);
    var rect = canvas.getBoundingClientRect();
    var ex = rect.left + rect.width / 2, ey = rect.top + rect.height / 2;
    var earthR = R * rect.width / W;

    var th = moonTh;
    var orad = earthR * M_ORBIT;
    var mx = ex + Math.cos(th) * orad, my = ey - Math.sin(th) * orad;
    var mr = earthR * M_RATIO;

    // Draw the same circle used to position the moon.
    mctx.beginPath();
    mctx.arc(ex, ey, orad, 0, Math.PI * 2);
    mctx.setLineDash([2, 6]);
    mctx.strokeStyle = colors.line;
    mctx.globalAlpha = 0.45;
    mctx.lineWidth = 1;
    mctx.stroke();
    mctx.setLineDash([]);
    mctx.globalAlpha = 1;
    if (mx < -mr - 40 || mx > MW + mr + 40 || my < -mr - 40 || my > MH + mr + 40) return;

    // faint limb
    mctx.beginPath();
    mctx.arc(mx, my, mr, 0, Math.PI * 2);
    mctx.strokeStyle = colors.limb;
    mctx.globalAlpha = 0.5;
    mctx.lineWidth = 1;
    mctx.stroke();
    mctx.globalAlpha = 1;

    // tidally locked: lon 0 keeps facing the earth as it orbits.
    // Each dot is lit by the real sun direction — so the phase you see
    // (new between earth and sun, full opposite) is the physics of phases.
    var cR = Math.cos(th), sR = Math.sin(th);
    mctx.fillStyle = colors.label;
    for (var i = 0; i < moonDots.length; i++) {
      var v = moonDots[i].v;
      // The local z axis faces Earth; the orbit normal faces the viewer.
      var p = { x: -v.x * sR - v.z * cR, y: v.x * cR - v.z * sR, z: -v.y };
      if (p.z <= 0.04) continue;
      var li = p.x * sunView.x + p.y * sunView.y + p.z * sunView.z;
      var lit = Math.max(0, Math.min(1, li * 5 + 0.1));
      var sun = 0.16 + 0.84 * lit;                  // 0.16 floor: earthshine
      var dr = (moonDots[i].mare ? 0.055 : 0.034) * mr;
      mctx.globalAlpha = (moonDots[i].mare ? 0.55 : 0.22) * Math.min(1, p.z * 2) * sun;
      mctx.beginPath();
      mctx.arc(mx + p.x * mr, my - p.y * mr, dr, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.globalAlpha = 1;
  }

  /* ----- pointer ripples: waves that travel over the surface -----
     The pointer is unprojected onto the sphere; each ripple is a growing
     geodesic circle stored in MODEL space, so it spins with the earth and
     slips around the limb like a real surface wave. */
  var ripples = [];
  var lastRX = -1, lastRY = -1;

  // screen -> model-space unit vector, or null when off the sphere
  function unproject(px, py) {
    var nx = (px - CX) / R, ny = (CY - py) / R;
    var d2 = nx * nx + ny * ny;
    if (d2 > 1) return null;
    var v = { x: nx, y: ny, z: Math.sqrt(1 - d2) };  // view space, front hemisphere
    var ct = Math.cos(-TILT), st = Math.sin(-TILT);  // undo tilt (rotate X by -TILT)
    var y = v.y * ct - v.z * st;
    var z = v.y * st + v.z * ct;
    var c = Math.cos(-rot), s = Math.sin(-rot);      // undo spin (rotate Y by -rot)
    return { x: v.x * c + z * s, y: y, z: z * c - v.x * s };
  }

  function spawnRipple(px, py, strong) {
    if (reduced) return;
    var c = unproject(px, py);
    if (!c) return;
    ripples.push({ c: c, age: 0, life: strong ? 1.8 : 1.1, maxPsi: strong ? 1.5 : 0.6, a: strong ? 0.6 : 0.32 });
    if (ripples.length > 16) ripples.shift();
  }

  function drawRipples(dt) {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      rp.age += dt;
      var f = rp.age / rp.life;
      if (f >= 1) { ripples.splice(i, 1); continue; }
      var ease = 1 - Math.pow(1 - f, 3);

      // orthonormal basis perpendicular to the ripple's center
      var c = rp.c;
      var ref = Math.abs(c.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      var u = { x: c.y * ref.z - c.z * ref.y, y: c.z * ref.x - c.x * ref.z, z: c.x * ref.y - c.y * ref.x };
      var ul = Math.hypot(u.x, u.y, u.z);
      u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
      var w = { x: c.y * u.z - c.z * u.y, y: c.z * u.x - c.x * u.z, z: c.x * u.y - c.y * u.x };

      ctx.strokeStyle = colors.arc;
      ctx.lineWidth = 1.2;
      for (var ring = 0; ring < 2; ring++) {           // wavefront + trailing crest
        var psi = ease * rp.maxPsi * (ring ? 0.62 : 1);
        if (psi < 0.02) continue;
        var cp = Math.cos(psi), sp = Math.sin(psi);
        var pts = [];
        for (var k = 0; k <= 48; k++) {
          var ph = (k / 48) * Math.PI * 2;
          var ca = Math.cos(ph), sa = Math.sin(ph);
          pts.push(view({
            x: c.x * cp + (u.x * ca + w.x * sa) * sp,
            y: c.y * cp + (u.y * ca + w.y * sa) * sp,
            z: c.z * cp + (u.z * ca + w.z * sa) * sp
          }));
        }
        ctx.globalAlpha = rp.a * (1 - f) * (ring ? 0.45 : 1);
        ctx.beginPath();
        polyline(pts);
        ctx.stroke();
      }
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

    sunView = view(sunModel);

    moonTh += M_SPEED * (warpT > 0 ? 6 : 1) * dt;

    ctx.clearRect(0, 0, W, H);
    drawMarks(now);
    drawGraticule();
    drawLand();
    drawDayNight();
    drawRipples(dt);
    drawRoutes();
    drawSatellites();
    drawMoonLayer();

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
    R = Math.min(W, H) * 0.40;
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
