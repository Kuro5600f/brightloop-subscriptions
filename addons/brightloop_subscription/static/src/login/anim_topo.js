/* Topo Field: WebGL topographic contour lines over a fine grid.
 * Ported from the "NexusNode" standalone page (UIUX/dark3.txt). Shader maths,
 * constants and tuned values are unchanged; page chrome, GSAP and overlays dropped.
 *
 * window.BlLoginAnim.topo(container, {reducedMotion}) -> {start, stop, destroy}
 * mount() paints one frame; start() runs the rAF loop (unless reducedMotion).
 */
(function () {
    "use strict";
    window.BlLoginAnim = window.BlLoginAnim || {};

    const MAX_DPR = 2;

    const VS = "attribute vec2 a_position;\n" +
        "void main() { gl_Position = vec4(a_position, 0.0, 1.0); }";

    // Same shader as the source. Only changes: precision guard, and the output is
    // premultiplied white with alpha = line intensity (identical to white-on-black
    // over a black page, but lets the page background show through).
    const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dpr;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    st.x *= u_resolution.x / u_resolution.y;

    // 1px physical grid rendering
    float gridSize = 48.0 * u_dpr;
    vec2 gridSt = gl_FragCoord.xy / gridSize;
    vec2 gridFract = fract(gridSt);
    float lineThickness = 1.0 / gridSize;
    float gridLines = step(1.0 - lineThickness, gridFract.x) + step(1.0 - lineThickness, gridFract.y);
    gridLines = clamp(gridLines, 0.0, 1.0) * 0.12;

    // Ultra-thin Topographic Lines
    float noiseScale = 1.4;
    vec2 noisePos = st * noiseScale + vec2(u_time * 0.015, u_time * 0.025);
    float n = snoise(noisePos) * 0.5 + 0.5;
    float numBands = 10.0;
    float bandVal = n * numBands;
    float triangleWave = abs(fract(bandVal) - 0.5) * 2.0;

    // Thinner smoothstep constraint for fine industrial aesthetic
    float topoLines = smoothstep(0.02, 0.00, triangleWave) * 0.45;

    float a = clamp(gridLines + topoLines, 0.0, 1.0);
    gl_FragColor = vec4(vec3(a), a);
}`;

    function noop() {
        return { start: function () {}, stop: function () {}, destroy: function () {} };
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

    window.BlLoginAnim.topo = function mount(container, opts) {
        const reduced = !!(opts && opts.reducedMotion);
        const canvas = document.createElement("canvas");
        let gl = null;
        try {
            gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
        } catch (e) {
            gl = null;
        }
        if (!gl) { return noop(); }

        const vs = compile(gl, gl.VERTEX_SHADER, VS);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        const prog = vs && fs ? gl.createProgram() : null;
        if (!prog) { return noop(); }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { return noop(); }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, "a_position");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        const uRes = gl.getUniformLocation(prog, "u_resolution");
        const uTime = gl.getUniformLocation(prog, "u_time");
        const uDpr = gl.getUniformLocation(prog, "u_dpr");

        canvas.setAttribute("aria-hidden", "true");
        canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none";
        if (window.getComputedStyle(container).position === "static") { container.style.position = "relative"; }
        container.appendChild(canvas);

        let t = 0;
        let last = -1;
        let raf = 0;
        let running = false;
        let dead = false;

        function draw() {
            gl.uniform1f(uTime, t);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
            const w = Math.max(1, Math.round(container.clientWidth * dpr));
            const h = Math.max(1, Math.round(container.clientHeight * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            gl.viewport(0, 0, w, h);
            gl.uniform2f(uRes, w, h);
            gl.uniform1f(uDpr, dpr);
            draw(); // resizing clears the canvas, so repaint straight away
        }

        function frame(now) {
            if (!running) { return; }
            raf = requestAnimationFrame(frame);
            const dt = last < 0 ? 0 : Math.min((now - last) / 1000, 0.05);
            last = now;
            t += dt;
            draw();
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
                if (reduced) { draw(); return; }
                running = true;
                last = -1;
                raf = requestAnimationFrame(frame);
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
                if (canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
                const ext = gl.getExtension("WEBGL_lose_context");
                if (ext) { ext.loseContext(); }
            }
        };
    };
})();
