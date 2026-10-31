/* Day scene: "Cloud Sky" (WebGL) behind a "Moonlit Petals" blossom crown (Canvas 2D),
 * recoloured for daytime. Ported from UIUX/light2.txt and UIUX/light4.txt.
 *
 * window.BlLoginAnim.day(container, {reducedMotion, colors?}) -> {start, stop, destroy}
 * Two stacked canvases: sky (back) and blossoms (front, transparent, bottom 45%).
 * mount() paints one frame; start() runs the rAF loop (unless reducedMotion).
 */
(function () {
    "use strict";
    window.BlLoginAnim = window.BlLoginAnim || {};

    const MAX_DPR = 2;
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const clamp01 = (v) => clamp(v, 0, 1);
    const smooth = (a, b, x) => {
        const t = clamp01((x - a) / (b - a || 1));
        return t * t * (3 - 2 * t);
    };

    // ======================================================================
    //  SKY  (Cloud Sky, light2.txt)
    // ======================================================================

    // Found on a parameter grid in the source; the look depends on these.
    const PUFF_UP = 0.34;
    const PUFF_DOWN = 0.19;
    const ERODE = 0.7;
    const SHADOW_STEP = 0.085;
    const NEAR_CELL = 1.05;
    const FAR_CELL = 2.15;
    const FAR_MIX = 0.55;
    const NEAR_DRIFT = 0.055;
    const FAR_DRIFT = 0.026;
    const CIRRUS_DRIFT = 0.014;
    const PUFF_WMAX = 2.15;
    const SHADE_BLEND = 12.0;

    // Source defaults + the source's own preset, resolved to shader units
    // (density 100, speed 64, size 130, softness 200, shadow 70, cirrus 100,
    //  sun 100/100, wind 300, parallax 300, damping 50).
    const SKY = {
        coverage: 1.0,
        speed: 64 / 50,
        size: 1.3,
        softness: 4.5 / 2.0,
        shadow: 0.7,
        cirrus: 1.0,
        sunX: 1.0,
        sunY: 1.0,
        parallax: 3.0,
        wind: 3.0,
        damping: 50
    };
    // The sky is soft, so it renders below CSS resolution to keep the heavy
    // fragment shader cheap on integrated GPUs.
    const SKY_SCALE = 0.75;

    // DAYTIME recolour (source: zenith #0075FF, horizon #B4D2F0, glow #FFFFFF).
    const DAY_COLORS = {
        zenith: "#8CC8F5",
        horizon: "#FFE8D2",
        cloud: "#FFFFFF",
        glow: "#FFE9B8"
    };

    const SKY_VERT = "attribute vec2 a_pos;\nvoid main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }";

    // Fragment shader: verbatim from the source.
    const SKY_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uNearX, uFarX, uCirrusX;
uniform float uCoverage, uSize, uSoftness, uShadow, uCirrus;
uniform vec3 uZenith, uHorizon, uCloud;
uniform vec4 uGlow;
uniform vec2 uSun;
uniform vec2 uParallax;

vec2 hash22(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float hash12(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 x){
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++){
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// One hashed puff cluster per cell, 5x5 window with an exact reach test; the
// height is an online soft-max over every puff (no creases in the cloud body).
vec2 blobs(vec2 uv, float seed){
  vec2 id = floor(uv), f = fract(uv);
  float best = -1e4;
  float wsum = 0.0, ysum = 0.0;
  float wMax = min(${PUFF_WMAX.toFixed(3)}, 0.72 * uSize);
  float reach = min(2.0, ceil(wMax + 0.85) - 1.0);
  for (int j = -2; j <= 2; j++){
    for (int i = -2; i <= 2; i++){
      vec2 o = vec2(float(i), float(j));
      if (max(abs(o.x), abs(o.y)) > reach) continue;
      vec2 h = hash22(id + o + seed);
      if (fract(h.x * 37.1) > uCoverage) continue;
      vec2 c = o + 0.15 + h * 0.7;
      float w = min(${PUFF_WMAX.toFixed(3)}, (0.30 + 0.42 * fract(h.y * 19.7)) * uSize);
      vec2 d = f - c;
      float ry = (d.y > 0.0 ? ${PUFF_UP.toFixed(3)} : ${PUFF_DOWN.toFixed(3)}) * uSize * (0.8 + 0.5 * fract(h.y * 7.3));
      float e = length(vec2(d.x / max(w, 1e-3), d.y / max(ry, 1e-3)));
      float val = 1.0 - e;
      float yN = d.y / max(ry, 1e-3);
      if (val > best){
        float k = exp(${SHADE_BLEND.toFixed(1)} * (best - val));
        wsum = wsum * k + 1.0;
        ysum = ysum * k + yN;
        best = val;
      } else {
        float g = exp(${SHADE_BLEND.toFixed(1)} * (val - best));
        wsum += g;
        ysum += g * yN;
      }
    }
  }
  return vec2(best, ysum / max(wsum, 1e-4));
}

// Blobs decide WHERE, noise decides the OUTLINE.
vec2 cloudField(vec2 uv, float seed, float detailScale){
  vec2 b = blobs(uv, seed);
  float n = fbm(uv * detailScale + seed * 3.1) * 0.72
          + fbm(uv * detailScale * 3.3 + seed * 7.7) * 0.28;
  return vec2(b.x - (1.0 - n) * ${ERODE.toFixed(3)}, b.y);
}

vec3 shadeCloud(float dyNorm, vec3 sky){
  float t = smoothstep(-0.95, 0.25, dyNorm);
  vec3 base = mix(uCloud * 0.52, sky, 0.34);
  return mix(mix(uCloud, base, uShadow), uCloud, t);
}

void main(){
  vec2 frag = gl_FragCoord.xy / max(uRes.y, 1.0);
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(frag.x, frag.y);

  vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.15, 1.05, p.y));
  vec2 sunP = vec2(uSun.x * aspect, uSun.y);
  float sd = length(p - sunP);
  sky += uGlow.rgb * uGlow.a * exp(-sd * 3.4) * 0.30;

  vec3 col = sky;

  if (uCirrus > 0.0) {
    vec2 cuv = vec2(p.x * 1.4 + uCirrusX, p.y * 5.5);
    float veil = fbm(cuv) * fbm(cuv * 2.3 + 9.0);
    veil = smoothstep(0.24, 0.55, veil) * smoothstep(0.15, 0.7, p.y);
    col = mix(col, uCloud, veil * uCirrus * 0.5);
  }

  vec2 fuv = vec2(p.x + uFarX, p.y) * ${FAR_CELL.toFixed(3)} + uParallax * 0.4;
  vec2 fd = cloudField(fuv, 17.0, 11.0);
  float fa = clamp(fd.x * uSoftness, 0.0, 1.0);
  if (fa > 0.0) {
    vec3 lit = shadeCloud(fd.y, sky);
    col = mix(col, mix(lit, sky, ${FAR_MIX.toFixed(3)}), fa);
  }

  vec2 nuv = vec2(p.x + uNearX, p.y) * ${NEAR_CELL.toFixed(3)} + uParallax;
  vec2 nd = cloudField(nuv, 3.0, 8.5);
  float na = clamp(nd.x * uSoftness, 0.0, 1.0);
  if (na > 0.0) {
    vec3 lit = shadeCloud(nd.y, sky);
    float above = clamp(cloudField(nuv + vec2(0.0, ${SHADOW_STEP.toFixed(3)}), 3.0, 8.5).x * uSoftness, 0.0, 1.0);
    lit *= 1.0 - 0.18 * uShadow * above;
    lit += uGlow.rgb * uGlow.a * 0.22 * exp(-length(p - sunP) * 1.6);
    col = mix(col, lit, na);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

    function parseHex(str, fb) {
        if (typeof str !== "string") { return fb; }
        let hex = str.trim();
        if (hex.charAt(0) !== "#") { return fb; }
        hex = hex.slice(1);
        if (hex.length === 3) { hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]; }
        if (hex.length < 6) { return fb; }
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) { return fb; }
        return [r / 255, g / 255, b / 255, hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1];
    }

    function compile(gl, type, src) {
        const sh = gl.createShader(type);
        if (!sh) { return null; }
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            gl.deleteShader(sh);
            return null;
        }
        return sh;
    }

    function setCanvasStyle(canvas, extra) {
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.cssText = "position:absolute;left:0;width:100%;display:block;pointer-events:none;" + extra;
    }

    function createSky(container, colors) {
        const canvas = document.createElement("canvas");
        let gl = null;
        try {
            gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
        } catch (e) {
            gl = null;
        }
        if (!gl) { return null; }
        const vs = compile(gl, gl.VERTEX_SHADER, SKY_VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, SKY_FRAG);
        const prog = vs && fs ? gl.createProgram() : null;
        if (!prog) { return null; }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { return null; }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, "a_pos");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const locs = {};
        const u = (name) => {
            if (!(name in locs)) { locs[name] = gl.getUniformLocation(prog, name); }
            return locs[name];
        };

        const zen = parseHex(colors.zenith, [0.55, 0.78, 0.96, 1]);
        const hor = parseHex(colors.horizon, [1, 0.91, 0.82, 1]);
        const cld = parseHex(colors.cloud, [1, 1, 1, 1]);
        const glow = parseHex(colors.glow, [1, 0.91, 0.72, 1]);

        setCanvasStyle(canvas, "top:0;height:100%;");
        container.appendChild(canvas);

        // Each layer keeps its own accumulator, wrapped on the CPU.
        let nearX = 0, farX = 0, cirrusX = 0, leanX = 0, leanY = 0;
        const ptr = { x: 0, y: 0, inside: false };
        let bw = 1, bh = 1;

        return {
            canvas: canvas,
            setPointer: function (x, y, inside) { ptr.x = x; ptr.y = y; ptr.inside = inside; },
            resize: function () {
                const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
                const ratio = Math.min(dpr, 1) * SKY_SCALE;
                bw = Math.max(1, Math.round(container.clientWidth * ratio));
                bh = Math.max(1, Math.round(container.clientHeight * ratio));
                if (canvas.width !== bw || canvas.height !== bh) {
                    canvas.width = bw;
                    canvas.height = bh;
                }
                gl.viewport(0, 0, bw, bh);
            },
            render: function (dt, still) {
                // Eased toward target; higher damping settles faster.
                const k = 1 - Math.exp(-SKY.damping * 0.12 * dt);
                leanX += ((ptr.inside ? ptr.x : 0) - leanX) * k;
                leanY += ((ptr.inside ? ptr.y : 0) - leanY) * k;
                // Pointer offset ADDS to the wind: one way speeds the drift, the other reverses it.
                const rate = still ? 0 : SKY.speed * (1 + leanX * SKY.wind);
                nearX = (nearX - NEAR_DRIFT * rate * dt) % 1000;
                farX = (farX - FAR_DRIFT * rate * dt) % 1000;
                cirrusX = (cirrusX - CIRRUS_DRIFT * rate * dt) % 1000;

                gl.uniform2f(u("uRes"), bw, bh);
                gl.uniform1f(u("uNearX"), nearX);
                gl.uniform1f(u("uFarX"), farX);
                gl.uniform1f(u("uCirrusX"), cirrusX);
                gl.uniform1f(u("uCoverage"), SKY.coverage);
                gl.uniform1f(u("uSize"), SKY.size);
                gl.uniform1f(u("uSoftness"), SKY.softness);
                gl.uniform1f(u("uShadow"), SKY.shadow);
                gl.uniform1f(u("uCirrus"), SKY.cirrus);
                gl.uniform2f(u("uSun"), SKY.sunX, SKY.sunY);
                gl.uniform2f(u("uParallax"), -leanX * SKY.parallax * 0.07, -leanY * SKY.parallax * 0.05);
                gl.uniform3f(u("uZenith"), zen[0], zen[1], zen[2]);
                gl.uniform3f(u("uHorizon"), hor[0], hor[1], hor[2]);
                gl.uniform3f(u("uCloud"), cld[0], cld[1], cld[2]);
                gl.uniform4f(u("uGlow"), glow[0], glow[1], glow[2], glow[3]);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            },
            destroy: function () {
                if (canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
                const ext = gl.getExtension("WEBGL_lose_context");
                if (ext) { ext.loseContext(); }
            }
        };
    }

    // ======================================================================
    //  BLOSSOMS  (Moonlit Petals, light4.txt)  -- transparent, recoloured
    // ======================================================================

    // The source's tuned advanced defaults, with the changes noted:
    //  flowers 11000 -> 6500 (perf), petalSize 100 -> 130 (smaller panel),
    //  bokehOpacity 85 -> 70 (bright background), branchColor -> warm brown.
    const ADV = {
        seed: 7, flowers: 6500, flowerSize: 6, clumpSize: 11, twigs: 30, crownReach: 100,
        branchColor: "#7A5C52", dofBlur: 3, petalSize: 130, fallSpeed: 100, nearShare: 16,
        drift: -5, wobble: 100, swayAmp: 8, swayPeriod: 3000, bokehFirst: 2330,
        bokehEvery: 6000, bokehSize: 8, bokehOpacity: 70, haloSize: 100
    };
    const PETAL_COUNT = 90; // source default 140
    const SPEED = 100 / 50; // source default speed=100 -> time scale 2
    const WIND = 30 / 30;
    const GLOW = 50 / 60;
    const PETAL_FRAC = 0.45; // blossom canvas height as a share of the panel
    const PETAL_MASK = "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 30%)";

    // Daytime blossom palettes: [soft pink, white blush, peach].
    const WHITE = [255, 255, 255];
    const VARIANTS = [
        { base: [247, 184, 204], shade: [212, 132, 166] },
        { base: [255, 243, 247], shade: [228, 186, 206] },
        { base: [255, 206, 180], shade: [226, 152, 132] }
    ];

    function mulberry32(seed) {
        let a = (seed | 0) + 0x6d2b79f5;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hash2(i, j, s) {
        let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 982451653)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function vnoise(x, y, s) {
        const i = Math.floor(x), j = Math.floor(y);
        const fx = x - i, fy = y - j;
        const u = fx * fx * (3 - 2 * fx);
        const v = fy * fy * (3 - 2 * fy);
        const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    const rgbStr = (c, a) =>
        "rgba(" + Math.round(clamp(c[0], 0, 255)) + "," + Math.round(clamp(c[1], 0, 255)) + "," +
        Math.round(clamp(c[2], 0, 255)) + "," + (a === undefined ? 1 : a) + ")";
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

    function quad(a, c, b, t) {
        const m = 1 - t;
        return { x: m * m * a.x + 2 * m * t * c.x + t * t * b.x, y: m * m * a.y + 2 * m * t * c.y + t * t * b.y };
    }
    function quadAngle(a, c, b, t) {
        const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
        const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
        return Math.atan2(dy, dx);
    }

    // Reference space is 736x414. Limbs: start, control, end, width.
    const LIMBS = [
        [-20, 10, 200, -30, 430, 60, 5],
        [-20, 60, 230, 40, 470, 185, 6],
        [60, -20, 250, 20, 370, 140, 4],
        [-20, 130, 190, 140, 425, 285, 5],
        [-20, 205, 150, 235, 335, 385, 5],
        [-15, 280, 90, 320, 210, 430, 4],
        [-20, 350, 60, 380, 120, 440, 3]
    ];
    // Ragged right edge of the crown: [y, x]
    const EDGE = [
        [-20, 390], [0, 395], [40, 420], [110, 440], [185, 475], [230, 455],
        [270, 430], [330, 400], [390, 352], [414, 320], [440, 300]
    ];
    function edgeX(y) {
        if (y <= EDGE[0][0]) { return EDGE[0][1]; }
        for (let i = 0; i < EDGE.length - 1; i++) {
            const y0 = EDGE[i][0], x0 = EDGE[i][1], y1 = EDGE[i + 1][0], x1 = EDGE[i + 1][1];
            if (y <= y1) { return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0); }
        }
        return EDGE[EDGE.length - 1][1];
    }
    const isBlur = (x, y) => (x < 160 && y > 255) || (x < 35 && y > 140);

    function buildTree(seed, total, fs, clumpSize, sprays, reach, bottom) {
        const rng = mulberry32(seed);
        const R = reach / 100;
        const ex = (y) => edgeX(y) * R;
        const branches = [];
        const clipLine = (pts) => {
            const out = [];
            for (const p of pts) {
                if (p.x > ex(p.y) + 25 || p.y > bottom + 16) { break; }
                out.push(p);
            }
            return out;
        };
        const grow = (x, y, a, len, w, depth) => {
            const pts = [{ x: x, y: y }];
            const steps = 5;
            const seg = len / steps;
            for (let s = 0; s < steps; s++) {
                a += (Math.PI / 2 - a) * 0.1 + (rng() - 0.5) * 0.35;
                x += Math.cos(a) * seg;
                y += Math.sin(a) * seg;
                pts.push({ x: x, y: y });
            }
            const c = clipLine(pts);
            if (c.length > 1) { branches.push({ pts: c, w: w }); }
            if (depth > 0) {
                for (let k = 0; k < 2; k++) {
                    const idx = 1 + Math.floor(rng() * (c.length - 1));
                    if (idx >= c.length) { continue; }
                    const p = c[idx];
                    grow(p.x, p.y, a + (k === 0 ? -0.55 : 0.55) + (rng() - 0.5) * 0.3, len * 0.62, w * 0.62, depth - 1);
                }
            }
        };
        const limbs = LIMBS.slice();
        for (let y0 = 425; y0 < bottom; y0 += 75) { limbs.push([-20, y0, 60, y0 + 30, 140, y0 + 90, 3]); }
        limbs.forEach((Ld) => {
            const A = { x: Ld[0], y: Ld[1] };
            const C = { x: Ld[2] * R, y: Ld[3] };
            const B = { x: Ld[4] * R, y: Ld[5] };
            const w = Ld[6];
            const pts = [];
            for (let i = 0; i <= 24; i++) { pts.push(quad(A, C, B, i / 24)); }
            const c = clipLine(pts);
            if (c.length > 1) { branches.push({ pts: c, w: w }); }
            for (let j = 0; j < 7; j++) {
                const t = 0.15 + (0.8 * (j + rng())) / 7;
                const q = quad(A, C, B, t);
                grow(q.x, q.y, quadAngle(A, C, B, t) + (j % 2 ? 0.5 : -0.4), 45 + rng() * 55, w * 0.4, 2);
            }
        });

        const density = (x, y) => {
            const e = ex(y);
            if (x > e) { return 0; }
            let d = 1;
            const cv = Math.pow((x - 235 * R) / (80 * R), 2) + Math.pow((y - 200) / 68, 2);
            if (cv < 1) { d *= 0.05 + 0.6 * cv * cv; }
            if (y > 235 && x > 165 * R) { d *= 0.12; }
            if (y > bottom - 29) { d *= 0.5; }
            d *= clamp(0.35 + 1.1 * vnoise(x / 38, y / 38, seed), 0, 1.2);
            return clamp01(d);
        };
        const light = (fx, fy, cx, cy, r) => {
            const e = ex(fy);
            let L = 0.28 + 0.55 * (fx / (470 * R)) - 0.35 * Math.min(1.1, Math.max(0, (fy - 170) / 240));
            L += (0.25 * (fx - cx - (fy - cy))) / (2 * r + 1);
            L += 0.15 * smooth(e - 70, e, fx);
            L += (rng() - 0.5) * 0.2;
            if (isBlur(fx, fy)) { L -= 0.08; }
            return clamp01(L);
        };

        const core = [];
        const coreBlur = [];
        const groups = [];
        const lobeMap = new Map();
        const K = Math.max(20, Math.round((total / 13) * (bottom / 414)));
        let made = 0;
        const xMax = ex(185) + 20;
        for (let tries = 0; tries < K * 30 && made < K; tries++) {
            const x = -12 + rng() * xMax;
            const y = -12 + rng() * (bottom + 26);
            if (rng() >= density(x, y)) { continue; }
            made++;
            const r = clumpSize * (0.6 + 0.6 * rng());
            const n = Math.max(3, Math.round(13 * Math.pow(r / clumpSize, 2)));
            let lobe = null;
            if (x > ex(y) - 55 && y > 15 && y < 250) {
                const key = Math.floor(y / 40);
                lobe = lobeMap.get(key) || null;
                if (!lobe) {
                    const yc = key * 40 + 20;
                    lobe = { pts: [], flowers: [], anchor: { x: ex(yc) - 120, y: yc }, tip: { x: ex(yc), y: yc }, back: false, blur: false };
                    lobeMap.set(key, lobe);
                    groups.push(lobe);
                }
            }
            for (let k = 0; k < n; k++) {
                const a = rng() * TAU;
                const dd = Math.sqrt(rng()) * r;
                const fx = x + Math.cos(a) * dd;
                const fy = y + Math.sin(a) * dd * 0.85;
                if (fx > ex(fy) + 6 || fy < -12 || fy > bottom + 12 || fx < -12) { continue; }
                const f = { x: fx, y: fy, r: fs * 0.5 * (0.65 + rng() * 0.65), L: light(fx, fy, x, y, r), rot: rng() * TAU };
                if (lobe) { lobe.flowers.push(f); }
                else if (isBlur(fx, fy)) { coreBlur.push(f); }
                else { core.push(f); }
            }
        }

        // hanging sprays in the lower right of the crown
        for (let i = 0; i < sprays; i++) {
            const xr = 195 + 265 * ((i + rng()) / Math.max(1, sprays));
            let x = xr * R;
            let y = 135 + 0.18 * (xr - 195) + rng() * 45;
            const len = (60 + rng() * 130) * (xr < 330 ? 1 : 0.7);
            let a = Math.PI / 2 + (rng() - 0.5) * 0.5;
            const pts = [{ x: x, y: y }];
            const flowers = [];
            let dist = 0;
            let nextF = 12 + rng() * 8;
            const steps = Math.ceil(len / 6);
            for (let s = 0; s < steps; s++) {
                a += (Math.PI / 2 - a) * 0.1 + (rng() - 0.5) * 0.15;
                x += Math.cos(a) * 6;
                y += Math.sin(a) * 6;
                if (y > bottom - 16) { break; }
                pts.push({ x: x, y: y });
                dist += 6;
                if (dist >= nextF) {
                    nextF = dist + 10 + rng() * 7;
                    const last = s >= steps - 2;
                    const fr = last ? 7 + rng() * 3 : 4 + rng() * 4;
                    const ox = x + (rng() - 0.5) * 8;
                    const oy = y;
                    if (ox > ex(oy) + 28) { continue; }
                    const n = Math.round(fr * fr * 0.18) + 3;
                    for (let k = 0; k < n; k++) {
                        const aa = rng() * TAU;
                        const dd = Math.sqrt(rng()) * fr;
                        const fx = ox + Math.cos(aa) * dd;
                        const fy = oy + Math.sin(aa) * dd * 0.85;
                        flowers.push({
                            x: fx, y: fy, r: fs * 0.5 * (0.65 + rng() * 0.65),
                            L: clamp01(light(fx, fy, ox, oy, fr) + 0.1), rot: rng() * TAU
                        });
                    }
                }
            }
            if (flowers.length) { groups.push({ pts: pts, flowers: flowers, anchor: pts[0], tip: pts[pts.length - 1], back: rng() < 0.3, blur: false }); }
        }
        return { branches: branches, groups: groups, core: core, coreBlur: coreBlur };
    }

    const mk = (w, h) => {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.ceil(w));
        c.height = Math.max(1, Math.ceil(h));
        return c;
    };

    function makePalette(v) {
        const pal = [], dark = [], lite = [], eye = [];
        for (let i = 0; i <= 64; i++) {
            const k = Math.pow(i / 64, 1.1);
            // shade -> base -> a touch of white on the lit side (no darkening to near-black)
            const c = k <= 0.75 ? mix(v.shade, v.base, k / 0.75) : mix(v.base, WHITE, Math.min(0.3, (k - 0.75) * 1.2));
            pal.push(rgbStr(c));
            dark.push(rgbStr(mix(c, [140, 55, 90], 0.38)));
            lite.push(rgbStr(mix(c, WHITE, 0.4)));
            eye.push(rgbStr(mix(c, [205, 70, 115], 0.6)));
        }
        return { pal: pal, dark: dark, lite: lite, eye: eye };
    }

    function bakeScene(Wd, Hd, geo) {
        const u = Hd / 414;
        const stretch = clamp(Wd / Hd / 1.778, 0.8, 1.25);
        const sx = u * stretch;
        const sy = u;
        const pals = VARIANTS.map(makePalette);
        const stam = rgbStr([250, 206, 122]);
        const peak = rgbStr(mix(VARIANTS[0].base, WHITE, 0.5));
        const branch = ADV.branchColor;
        const variantOf = (f) => {
            const q = (f.rot * 12.9898) % 1;
            return q < 0.5 ? 0 : q < 0.8 ? 1 : 2;
        };

        // res: pixels per device px of the target canvas; detail is only drawn where it can show
        const drawFlowers = (g, fl, res) => {
            res = res || 1;
            const list = fl.slice().sort((a, b) => a.L - b.L);
            for (const f of list) {
                const X = f.x * sx;
                const Y = f.y * sy;
                const R = f.r * u;
                const ci = Math.round(f.L * 64);
                const pv = pals[variantOf(f)];
                if (R * res < 3) {
                    g.fillStyle = pv.pal[ci];
                    g.beginPath();
                    for (let k = 0; k < 5; k++) {
                        const a = f.rot + k * 1.2566;
                        const px = X + Math.cos(a) * R * 0.45;
                        const py = Y + Math.sin(a) * R * 0.45;
                        g.moveTo(px + R * 0.5, py);
                        g.arc(px, py, R * 0.5, 0, TAU);
                    }
                    g.fill();
                } else {
                    // five notched petals, foreshortened as each flower faces its own way
                    const sq = 0.62 + 0.38 * Math.abs(Math.cos(f.rot * 2.3));
                    const tilt = f.rot * 0.7;
                    g.save();
                    g.translate(X, Y);
                    g.rotate(tilt);
                    g.scale(1, sq);
                    g.rotate(f.rot - tilt);
                    g.fillStyle = pv.pal[ci];
                    g.beginPath();
                    for (let k = 0; k < 5; k++) {
                        const a = k * 1.2566;
                        const cx = Math.cos(a) * R * 0.5;
                        const cy = Math.sin(a) * R * 0.5;
                        g.moveTo(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5);
                        g.ellipse(cx, cy, R * 0.5, R * 0.34, a, 0, TAU);
                    }
                    g.fill();
                    g.strokeStyle = pv.dark[ci];
                    g.lineWidth = Math.max(0.5 / res, R * 0.07);
                    g.globalAlpha = 0.55;
                    g.stroke();
                    // lit sheen on each petal
                    g.globalAlpha = 0.45 * f.L;
                    g.fillStyle = pv.lite[ci];
                    g.beginPath();
                    for (let k = 0; k < 5; k++) {
                        const a = k * 1.2566;
                        const cx = Math.cos(a) * R * 0.6;
                        const cy = Math.sin(a) * R * 0.6;
                        g.moveTo(cx + Math.cos(a) * R * 0.26, cy + Math.sin(a) * R * 0.26);
                        g.ellipse(cx, cy, R * 0.26, R * 0.16, a, 0, TAU);
                    }
                    g.fill();
                    // notches at the petal tips
                    g.globalAlpha = 0.8;
                    g.fillStyle = pv.dark[ci];
                    g.beginPath();
                    for (let k = 0; k < 5; k++) {
                        const a = k * 1.2566;
                        const nx = Math.cos(a) * R * 0.98;
                        const ny = Math.sin(a) * R * 0.98;
                        g.moveTo(nx + R * 0.09, ny);
                        g.arc(nx, ny, R * 0.09, 0, TAU);
                    }
                    g.fill();
                    // deep pink eye
                    g.globalAlpha = 1;
                    g.fillStyle = pv.eye[ci];
                    g.beginPath();
                    g.arc(0, 0, R * 0.26, 0, TAU);
                    g.fill();
                    // stamens on the larger flowers
                    if (R * res >= 5) {
                        g.strokeStyle = stam;
                        g.fillStyle = stam;
                        g.lineWidth = Math.max(0.4 / res, R * 0.04);
                        g.globalAlpha = 0.7;
                        g.beginPath();
                        for (let k = 0; k < 7; k++) {
                            const a = 0.4 + k * 0.8976;
                            g.moveTo(0, 0);
                            g.lineTo(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42);
                        }
                        g.stroke();
                        g.globalAlpha = 0.9;
                        g.beginPath();
                        for (let k = 0; k < 7; k++) {
                            const a = 0.4 + k * 0.8976;
                            const dx = Math.cos(a) * R * 0.44;
                            const dy = Math.sin(a) * R * 0.44;
                            g.moveTo(dx + R * 0.06, dy);
                            g.arc(dx, dy, R * 0.06, 0, TAU);
                        }
                        g.fill();
                    }
                    g.globalAlpha = 1;
                    g.restore();
                }
                if (f.L > 0.78) {
                    g.globalAlpha = 0.35 * smooth(0.78, 1, f.L);
                    g.fillStyle = peak;
                    g.beginPath();
                    g.arc(X + R * 0.2, Y - R * 0.2, R * 0.4, 0, TAU);
                    g.fill();
                    g.globalAlpha = 1;
                }
            }
        };
        const strokeLine = (g, pts, w0, taper) => {
            g.strokeStyle = branch;
            g.lineCap = "round";
            for (let i = 0; i < pts.length - 1; i++) {
                g.lineWidth = Math.max(0.6, w0 * (1 - (i / pts.length) * taper));
                g.beginPath();
                g.moveTo(pts[i].x * sx, pts[i].y * sy);
                g.lineTo(pts[i + 1].x * sx, pts[i + 1].y * sy);
                g.stroke();
            }
        };

        // core (static mass) with the branch network behind it
        const core = mk(Wd, Hd);
        const cg = core.getContext("2d");
        for (const l of geo.branches) { strokeLine(cg, l.pts, l.w * u * 0.5, 0.6); }
        drawFlowers(cg, geo.core, 1);

        // depth-of-field layer: drawn small, stretched back up
        const fb = 1 / clamp(1 + ADV.dofBlur * u * 0.5, 1, 12);
        const coreBlur = mk(Wd * fb, Hd * fb);
        const bg2 = coreBlur.getContext("2d");
        bg2.setTransform(fb, 0, 0, fb, 0, 0);
        drawFlowers(bg2, geo.coreBlur, fb);

        // sprites: hanging sprays and edge lobes that sway
        const srng = mulberry32(ADV.seed + 3);
        const sprites = [];
        for (const gr of geo.groups) {
            if (gr.flowers.length === 0) { continue; }
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const p of gr.pts) {
                x0 = Math.min(x0, p.x * sx);
                y0 = Math.min(y0, p.y * sy);
                x1 = Math.max(x1, p.x * sx);
                y1 = Math.max(y1, p.y * sy);
            }
            for (const f of gr.flowers) {
                const R = f.r * u;
                x0 = Math.min(x0, f.x * sx - R);
                y0 = Math.min(y0, f.y * sy - R);
                x1 = Math.max(x1, f.x * sx + R);
                y1 = Math.max(y1, f.y * sy + R);
            }
            x0 -= 4; y0 -= 4; x1 += 4; y1 += 4;
            const res = gr.blur ? fb : 1;
            const c = mk((x1 - x0) * res, (y1 - y0) * res);
            const g = c.getContext("2d");
            g.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
            if (gr.pts.length > 1) { strokeLine(g, gr.pts, 0.9 * u * 0.5, 0.4); }
            drawFlowers(g, gr.flowers, res);
            const ax = gr.anchor.x * sx, ay = gr.anchor.y * sy;
            const tx = gr.tip.x * sx, ty = gr.tip.y * sy;
            sprites.push({
                c: c, bx: x0, by: y0, bw: x1 - x0, bh: y1 - y0, ax: ax, ay: ay, tx: tx, ty: ty,
                len: Math.hypot(tx - ax, ty - ay), back: gr.back,
                pf: 0.7 + srng() * 0.6, ph: srng() * TAU, ph2: srng() * TAU, g: 0, gv: 0, th: 0
            });
        }

        // glow: highlights at 1/4, halo by repeated halving
        const hq = 0.25;
        const hCan = mk(Wd * hq, Hd * hq);
        const hg = hCan.getContext("2d");
        hg.setTransform(hq, 0, 0, hq, 0, 0);
        hg.fillStyle = peak;
        const allF = geo.core.concat(geo.coreBlur);
        for (const gr of geo.groups) { for (const f of gr.flowers) { allF.push(f); } }
        for (const f of allF) {
            if (f.L < 0.78) { continue; }
            hg.globalAlpha = 0.7 * ((f.L - 0.78) / 0.22);
            hg.beginPath();
            hg.arc(f.x * sx, f.y * sy, f.r * u * 1.4, 0, TAU);
            hg.fill();
        }
        const target = Math.max(4, 10 * u * (ADV.haloSize / 100));
        let div = 4;
        let halo = hCan;
        while (div * 2 <= target && halo.width > 4) {
            const n = mk(halo.width / 2, halo.height / 2);
            const ng = n.getContext("2d");
            ng.imageSmoothingQuality = "high";
            ng.drawImage(halo, 0, 0, n.width, n.height);
            halo = n;
            div *= 2;
        }
        return { core: core, coreBlur: coreBlur, sprites: sprites, halo: halo, bloom: hCan };
    }

    function createPetals(container, reduced) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) { return null; }
        setCanvasStyle(canvas, "bottom:0;height:" + (PETAL_FRAC * 100) + "%;" +
            "-webkit-mask-image:" + PETAL_MASK + ";mask-image:" + PETAL_MASK + ";");
        container.appendChild(canvas);

        const seed = ADV.seed;
        const geo = buildTree(seed, ADV.flowers, Math.max(2, ADV.flowerSize), Math.max(4, ADV.clumpSize),
            clamp(Math.round(ADV.twigs), 0, 60), clamp(ADV.crownReach, 40, 160), 414);
        let scene = null;
        let sceneKey = "";
        let Wd = 1, Hd = 1, dpr = 1;
        let t = 0;

        // falling petals
        const spawnX = (r) => (r() < 0.22 ? 0.2 + 0.42 * r() : 0.5 + 0.5 * ((r() + r()) / 2));
        const liveRng = mulberry32(seed + 17);
        const parts = [];
        {
            const r = mulberry32(seed + 5);
            const s = clamp(ADV.nearShare / 100, 0.01, 0.9);
            const k = Math.log(0.7) / Math.log(1 - s);
            for (let i = 0; i < PETAL_COUNT; i++) {
                const z = Math.pow(r(), k);
                parts.push({
                    x: spawnX(r), y: -0.04 + r() * 1.08, z: z, ph: r() * TAU, wob: TAU / (1 + r()),
                    spin: r() * TAU, spinV: 1.5 + r() * 2.5, rot: r() * TAU, ci: Math.floor(r() * 8),
                    a: clamp(0.45 + 0.55 * z + (r() - 0.5) * 0.2, 0.3, 1), ox: 0, oy: 0
                });
            }
            parts.sort((a, b) => a.z - b.z);
        }
        // petal colours: white blush toward blossom pink/peach
        const petalCols = [];
        for (let i = 0; i < 8; i++) {
            petalCols.push(rgbStr(mix([255, 248, 250], i % 2 ? VARIANTS[0].base : VARIANTS[2].base, (i / 7) * 0.75)));
        }
        // near-lens bokeh petals
        const bokeh = (function () {
            const r = mulberry32(seed + 23);
            const first = ADV.bokehFirst / 1000;
            const every = Math.max(0.5, ADV.bokehEvery / 1000);
            return {
                r: r, every: every,
                list: [{ t0: 0.39, x: 0.81, s: 0.22 }, { t0: first, x: 0.3, s: 1 }],
                nextT: first + every * (0.7 + 0.6 * r())
            };
        })();
        const bokehPink = mix(VARIANTS[0].base, WHITE, 0.35);

        const ptr = { x: 0, y: 0, inside: false, down: false, over: 0, press: 0 };

        function drawAdd(img, a) {
            ctx.globalCompositeOperation = "lighter";
            while (a > 0.001) {
                ctx.globalAlpha = Math.min(1, a);
                ctx.drawImage(img, 0, 0, Wd, Hd);
                a -= 1;
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
        }

        return {
            canvas: canvas,
            setPointer: function (x, y, inside) { ptr.x = x; ptr.y = y; ptr.inside = inside; },
            setDown: function (d) { ptr.down = d; },
            resize: function () {
                dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
                Wd = Math.max(1, Math.round(container.clientWidth * dpr));
                Hd = Math.max(1, Math.round(container.clientHeight * PETAL_FRAC * dpr));
                if (canvas.width !== Wd) { canvas.width = Wd; }
                if (canvas.height !== Hd) { canvas.height = Hd; }
            },
            render: function (dt) {
                if (Wd < 2 || Hd < 2) { return; }
                const spd = reduced ? 0 : SPEED;
                const dts = dt * spd;
                t += dts;

                const sk = Wd + "x" + Hd;
                if (!scene || sk !== sceneKey) {
                    scene = bakeScene(Wd, Hd, geo);
                    sceneKey = sk;
                }
                while (bokeh.nextT < t + 1) {
                    bokeh.list.push({ t0: bokeh.nextT, x: 0.2 + 0.65 * bokeh.r(), s: 0.45 + 0.55 * bokeh.r() });
                    bokeh.nextT += bokeh.every * (0.7 + 0.6 * bokeh.r());
                }
                if (bokeh.list.length > 6) { bokeh.list = bokeh.list.filter((e) => t - e.t0 < 2); }

                ptr.over += ((ptr.inside ? 1 : 0) - ptr.over) * (1 - Math.exp(-dt * 4));
                ptr.press += ((ptr.down ? 1 : 0) - ptr.press) * (1 - Math.exp(-dt * 6));
                const pAmt = ptr.over; // hover 50 / 50
                const pxd = ptr.x * dpr;
                const pyd = ptr.y * dpr;

                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
                ctx.clearRect(0, 0, Wd, Hd);
                drawAdd(scene.halo, 0.5 * GLOW);

                // sprite sway + pointer swing (underdamped spring)
                const swayA = (ADV.swayAmp / 1000) * Wd * WIND;
                const period = Math.max(0.3, ADV.swayPeriod / 1000);
                const Rg = 0.26 * Wd;
                for (const s of scene.sprites) {
                    const reach = clamp(s.tx / (0.55 * Wd), 0.15, 1.3);
                    const thA = (swayA * reach) / Math.max(s.len, 8);
                    const om = TAU / (period * s.pf);
                    const base = (thA * (Math.sin(om * t + s.ph) + 0.35 * Math.sin(2.27 * om * t + s.ph2))) / 1.35;
                    let gt = 0;
                    if (pAmt > 0.001) {
                        const dx = s.tx - pxd;
                        const dy = s.ty - pyd;
                        const d = Math.hypot(dx, dy);
                        if (d < Rg) {
                            const f = Math.pow(1 - d / Rg, 2);
                            const vx = s.tx - s.ax;
                            const vy = s.ty - s.ay;
                            const vl = Math.hypot(vx, vy) || 1;
                            const dir = ((-vy / vl) * dx + (vx / vl) * dy) / (d || 1);
                            gt = dir * f * 0.15 * pAmt * (1 + ptr.press);
                        }
                    }
                    s.gv += ((gt - s.g) * 40 - s.gv * 4.5) * dt;
                    s.g = clamp(s.g + s.gv * dt, -0.35, 0.35);
                    s.th = base + s.g;
                }
                const drawSprites = (back) => {
                    for (const s of scene.sprites) {
                        if (s.back !== back) { continue; }
                        const c = Math.cos(s.th);
                        const sn = Math.sin(s.th);
                        ctx.setTransform(c, sn, -sn, c, s.ax, s.ay);
                        ctx.drawImage(s.c, s.bx - s.ax, s.by - s.ay, s.bw, s.bh);
                    }
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                };
                ctx.drawImage(scene.coreBlur, 0, 0, Wd, Hd);
                drawSprites(true);
                ctx.drawImage(scene.core, 0, 0, Wd, Hd);
                drawSprites(false);
                drawAdd(scene.bloom, 0.14 * GLOW);

                // falling petals
                const uP = (Hd / 414) * (ADV.petalSize / 100);
                const fall = ADV.fallSpeed / 100;
                const drift = ADV.drift / 1000;
                const wobK = WIND * (ADV.wobble / 100);
                const Rp = 0.14 * Wd;
                const push = 0.05 * Wd * pAmt * (1 + ptr.press);
                const kE = 1 - Math.exp(-dt * 5);
                for (const p of parts) {
                    p.y += (0.03 + 0.14 * p.z) * fall * dts;
                    p.x += drift * (0.5 + p.z) * WIND * dts;
                    p.spin += p.spinV * dts;
                    if (p.y > 1.05) {
                        p.y = -0.04 - liveRng() * 0.04;
                        p.x = spawnX(liveRng);
                    }
                    if (p.x < -0.06) { p.x += 1.12; }
                    else if (p.x > 1.06) { p.x -= 1.12; }
                    const wx = Math.sin(p.wob * t + p.ph) * (0.006 + 0.012 * p.z) * Wd * wobK;
                    const bx = p.x * Wd + wx;
                    const by = p.y * Hd;
                    let tx = 0, ty = 0;
                    if (push > 0.01) {
                        const dx = bx - pxd;
                        const dy = by - pyd;
                        const d = Math.hypot(dx, dy);
                        if (d < Rp) {
                            const f = Math.pow(1 - d / Rp, 2) * (0.5 + p.z);
                            tx = (dx / (d || 1)) * f * push;
                            ty = (dy / (d || 1)) * f * push;
                        }
                    }
                    p.ox += (tx - p.ox) * kE;
                    p.oy += (ty - p.oy) * kE;
                    const X = bx + p.ox;
                    const Y = by + p.oy;
                    const r = (0.6 + 2.6 * Math.pow(p.z, 1.5)) * uP;
                    const face = Math.abs(Math.cos(p.spin));
                    const ang = p.rot + 0.5 * Math.sin(p.wob * t + p.ph);
                    const al = p.a * (0.55 + 0.45 * face);
                    ctx.fillStyle = petalCols[p.ci];
                    if (p.z > 0.7) {
                        ctx.globalAlpha = al * 0.18;
                        ctx.beginPath();
                        ctx.ellipse(X, Y, r * 1.8, Math.max(0.6 * r, 1.4 * r * face), ang, 0, TAU);
                        ctx.fill();
                    }
                    ctx.globalAlpha = al;
                    ctx.beginPath();
                    ctx.ellipse(X, Y, r, Math.max(0.35 * r, 0.8 * r * face), ang, 0, TAU);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;

                // near-lens bokeh petals (normal blend in daytime, not additive)
                if (!reduced) {
                    const bop = ADV.bokehOpacity / 100;
                    for (const e of bokeh.list) {
                        const age = t - e.t0;
                        const life = 0.2 + 0.1 * e.s;
                        if (age < 0 || age > life) { continue; }
                        const a = Math.pow(Math.sin(Math.PI * (age / life)), 0.8) * bop;
                        const r = (ADV.bokehSize / 100) * Wd * 0.5 * e.s;
                        const x = e.x * Wd - 0.47 * Wd * age;
                        const y = -r + 2.2 * Hd * age;
                        ctx.setTransform(1.15, 0, 0, 0.9, x, y);
                        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
                        gr.addColorStop(0, "rgba(255,250,252," + a + ")");
                        gr.addColorStop(0.45, "rgba(255,244,250," + (a * 0.85) + ")");
                        gr.addColorStop(0.75, rgbStr(bokehPink, a * 0.35));
                        gr.addColorStop(1, rgbStr(bokehPink, 0));
                        ctx.fillStyle = gr;
                        ctx.beginPath();
                        ctx.arc(0, 0, r, 0, TAU);
                        ctx.fill();
                    }
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                }
            },
            destroy: function () {
                if (canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
            }
        };
    }

    // ======================================================================
    //  MOUNT
    // ======================================================================

    function noop() {
        return { start: function () {}, stop: function () {}, destroy: function () {} };
    }

    window.BlLoginAnim.day = function mount(container, opts) {
        opts = opts || {};
        const reduced = !!opts.reducedMotion;
        if (window.getComputedStyle(container).position === "static") { container.style.position = "relative"; }

        const colors = Object.assign({}, DAY_COLORS, opts.colors || {});
        const sky = createSky(container, colors); // behind
        const petals = createPetals(container, reduced); // in front
        if (!sky && !petals) { return noop(); }

        let raf = 0;
        let last = -1;
        let running = false;
        let dead = false;

        function paint(dt) {
            if (sky) { sky.render(dt, reduced); }
            if (petals) { petals.render(dt); }
        }
        function resize() {
            if (sky) { sky.resize(); }
            if (petals) { petals.resize(); }
            paint(0); // resizing clears the canvases, so repaint straight away
        }
        function loop(now) {
            if (!running) { return; }
            raf = requestAnimationFrame(loop);
            const dt = last < 0 ? 0 : Math.min((now - last) / 1000, 0.05);
            last = now;
            paint(dt);
        }

        // pointer interaction, listened on the container only
        function onMove(e) {
            const r = container.getBoundingClientRect();
            if (sky && r.width > 0 && r.height > 0) {
                sky.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2, true);
            }
            if (petals) {
                const pr = petals.canvas.getBoundingClientRect();
                petals.setPointer(e.clientX - pr.left, e.clientY - pr.top, true);
            }
        }
        function onLeave() {
            if (sky) { sky.setPointer(0, 0, false); }
            if (petals) { petals.setPointer(0, 0, false); petals.setDown(false); }
        }
        function onDown(e) { onMove(e); if (petals) { petals.setDown(true); } }
        function onUp() { if (petals) { petals.setDown(false); } }
        if (!reduced) {
            container.addEventListener("pointermove", onMove);
            container.addEventListener("pointerenter", onMove);
            container.addEventListener("pointerleave", onLeave);
            container.addEventListener("pointerdown", onDown);
            container.addEventListener("pointerup", onUp);
            container.addEventListener("pointercancel", onUp);
        }

        let ro = null;
        let onWinResize = null;
        if (typeof ResizeObserver === "function") {
            ro = new ResizeObserver(function () { if (!dead) { resize(); } });
            ro.observe(container);
        } else {
            onWinResize = function () { if (!dead) { resize(); } };
            window.addEventListener("resize", onWinResize);
        }
        resize();

        return {
            start: function () {
                if (dead || running) { return; }
                if (reduced) { paint(0); return; }
                running = true;
                last = -1;
                raf = requestAnimationFrame(loop);
            },
            stop: function () {
                running = false;
                if (raf) { cancelAnimationFrame(raf); raf = 0; }
            },
            destroy: function () {
                if (dead) { return; }
                dead = true;
                running = false;
                if (raf) { cancelAnimationFrame(raf); raf = 0; }
                if (ro) { ro.disconnect(); }
                if (onWinResize) { window.removeEventListener("resize", onWinResize); }
                container.removeEventListener("pointermove", onMove);
                container.removeEventListener("pointerenter", onMove);
                container.removeEventListener("pointerleave", onLeave);
                container.removeEventListener("pointerdown", onDown);
                container.removeEventListener("pointerup", onUp);
                container.removeEventListener("pointercancel", onUp);
                if (petals) { petals.destroy(); }
                if (sky) { sky.destroy(); }
            }
        };
    };
})();
