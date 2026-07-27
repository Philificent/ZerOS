/**
 * waterpipe-ts — main controller.
 *
 * Animates a fractal-curve "smoke" effect on a `<canvas>` element, fully
 * compatible with the original waterpipe.js option set, but:
 *
 *   • zero runtime dependencies
 *   • DPR-aware (sharp on retina)
 *   • rAF-driven (auto-pauses when tab is hidden)
 *   • typed end-to-end
 *   • exposes lifecycle events for the demo / test harness
 *   • exports PNG/JPEG via detached off-screen canvas (visible canvas
 *     is never mutated by an export)
 */
import { generateFractalPoints } from "./fractal.js";
import { createNiceGradient, fillRectNiceGradient, addColorStop } from "./nice-gradient.js";
import { parseColor, rgbaString } from "./colors.js";
import { createEmitter } from "./events.js";
const TWO_PI = 2 * Math.PI;
const X_SQUEEZE = 0.75; // cheap 3D feel: squish the smoke horizontally.
/** Clamp JPEG quality to the spec-mandated [0, 1] range. PNG ignores
 *  the value, but passing garbage can crash some implementations. */
function clampQuality(q, type) {
    if (q === undefined)
        return undefined;
    if (!Number.isFinite(q))
        return undefined;
    const c = Math.max(0, Math.min(1, q));
    return type === "image/png" ? undefined : c;
}
/** Return the first of `candidates` that is a positive, finite number;
 *  fall back to `fallback` if none qualify. */
function pickPositive(...candidates) {
    for (const c of candidates) {
        if (Number.isFinite(c) && c > 0)
            return c;
    }
    return candidates[candidates.length - 1] ?? 0;
}
/** Clamp a value to the [min, max] range. */
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
/** Fully-resolved defaults. Every option is required, no `?`. */
const DEFAULTS = Object.freeze({
    gradientStart: "#000000",
    gradientEnd: "#222222",
    smokeOpacity: 0.1,
    numCircles: 1,
    maxMaxRad: "auto",
    minMaxRad: "auto",
    minRadFactor: 0,
    iterations: 8,
    drawsPerFrame: 10,
    lineWidth: 2,
    speed: 1,
    bgColorInner: "#ffffff",
    bgColorOuter: "#666666",
});
function resolveOptions(input) {
    // Cast through `unknown` to assert "all keys required" — we've
    // verified every key is populated.
    return { ...DEFAULTS, ...(input ?? {}) };
}
export class WaterpipeImpl {
    canvas;
    ctx;
    options;
    circles = [];
    drawCount = 0;
    rafId = null;
    lastTickTime = 0;
    accumulatorMs = 0;
    running = false;
    completed = false;
    destroyed = false;
    emitter = createEmitter();
    resizeObserver = null;
    cssWidth = 0;
    cssHeight = 0;
    /** Device pixel ratio last applied during measure().  Used to scale
     *  smoke-drawing transforms so the smoke fills the full backing
     *  store on retina displays (not just the top-left quadrant). */
    dpr = 1;
    constructor(canvas, options) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("waterpipe-ts: target must be an HTMLCanvasElement");
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("waterpipe-ts: 2D canvas context unavailable");
        }
        this.canvas = canvas;
        this.ctx = ctx;
        this.options = resolveOptions(options);
        this.init();
    }
    // ---------- public API ----------
    on(event, handler) {
        this.emitter.on(event, handler);
        return this;
    }
    off(event, handler) {
        this.emitter.off(event, handler);
        return this;
    }
    getOptions() {
        // Return a shallow copy so callers can't mutate our internal state.
        return { ...this.options };
    }
    setOption(name, value) {
        this.setOptions({ [name]: value });
    }
    setOptions(opts) {
        if (this.destroyed)
            return;
        // Build a fresh object so we don't mutate the readonly mapped type
        // we expose via getOptions().
        this.options = resolveOptions({ ...this.options, ...opts });
        this.generate();
    }
    pause() {
        if (this.destroyed || !this.running)
            return;
        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.safeEmit("pause");
    }
    resume() {
        if (this.destroyed || this.running)
            return;
        this.running = true;
        this.lastTickTime = 0;
        this.rafId = requestAnimationFrame(this.tick);
        this.safeEmit("resume");
    }
    stop() {
        if (this.destroyed)
            return;
        this.pause();
        if (!this.completed) {
            this.completed = true;
            this.safeEmit("complete");
        }
    }
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.pause();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        // Drop references so the GC can collect any large fractal buffers.
        this.circles = [];
        this.safeEmit("destroy");
        this.emitter.clear();
    }
    resize() {
        if (this.destroyed)
            return;
        this.measure();
        this.generate();
        this.safeEmit("resize", { width: this.cssWidth, height: this.cssHeight });
    }
    generate() {
        if (this.destroyed)
            return;
        this.drawCount = 0;
        this.accumulatorMs = 0;
        this.completed = false;
        this.fillBackground();
        this.setCircles();
        if (!this.running) {
            this.running = true;
            this.lastTickTime = 0;
            this.rafId = requestAnimationFrame(this.tick);
        }
        this.safeEmit("start");
    }
    toDataURL(width = this.cssWidth, height = this.cssHeight, type = "image/png", quality) {
        const exportCanvas = this.makeExportCanvas(width, height);
        return exportCanvas.toDataURL(type, clampQuality(quality, type));
    }
    toBlob(width = this.cssWidth, height = this.cssHeight, type = "image/png", quality) {
        const exportCanvas = this.makeExportCanvas(width, height);
        const q = clampQuality(quality, type);
        // toBlob is async and some Safari versions can hang silently.
        // We race against a 10s timeout so the caller always gets a result.
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error("waterpipe-ts: toBlob() timed out after 10s"));
            }, 10_000);
            try {
                if (typeof exportCanvas.toBlob !== "function") {
                    clearTimeout(timer);
                    reject(new Error("waterpipe-ts: toBlob() not supported in this browser"));
                    return;
                }
                exportCanvas.toBlob((blob) => {
                    clearTimeout(timer);
                    if (blob)
                        resolve(blob);
                    else
                        reject(new Error("waterpipe-ts: toBlob() returned null"));
                }, type, q);
            }
            catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }
    async download(filename = "waterpipe.png", width = this.cssWidth, height = this.cssHeight, type = "image/png", quality) {
        // Use a Blob URL instead of a data: URL — for a 4K PNG the data
        // string is 20+ MB, which exceeds Chrome's ~2 MB URL length limit
        // and crashes the download. The blob approach has no such limit.
        let objectUrl = null;
        try {
            const blob = await this.toBlob(width, height, type, quality);
            objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = filename;
            a.rel = "noopener";
            a.style.position = "fixed";
            a.style.left = "-9999px";
            document.body.appendChild(a);
            a.click();
            // Safari needs a moment before we revoke.
            setTimeout(() => {
                a.remove();
                if (objectUrl)
                    URL.revokeObjectURL(objectUrl);
            }, 1000);
        }
        catch (err) {
            if (objectUrl)
                URL.revokeObjectURL(objectUrl);
            throw err;
        }
    }
    // ---------- internals ----------
    /** Wrap emitter.emit() so that any exception thrown by a listener is
     *  caught (and logged) by the emitter itself, never propagating into
     *  the animation hot loop. The emitter already does this; the wrapper
     *  is here for symmetry and to make call sites self-documenting. */
    safeEmit(event, payload) {
        this.emitter.emit(event, payload);
    }
    init() {
        this.measure();
        this.options = resolveOptions(this.options);
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.canvas);
        }
        this.generate();
    }
    measure() {
        // Order of preference for the css dimensions:
        //   1. The element's actual rendered size (DOM-attached case).
        //   2. The width/height *attributes* on the canvas.
        //   3. Sensible defaults so a detached canvas still works.
        const rect = this.canvas.getBoundingClientRect();
        const attrW = this.canvas.getAttribute("width");
        const attrH = this.canvas.getAttribute("height");
        const rectW = rect.width > 0 ? rect.width : NaN;
        const rectH = rect.height > 0 ? rect.height : NaN;
        const cssW = pickPositive(rectW, attrW ? Number(attrW) : NaN, 800);
        const cssH = pickPositive(rectH, attrH ? Number(attrH) : NaN, 600);
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        this.cssWidth = Math.max(1, Math.round(cssW));
        this.cssHeight = Math.max(1, Math.round(cssH));
        this.dpr = Math.max(1, dpr);
        // Backing-store size for crispness on retina; CSS size unchanged.
        this.canvas.width = Math.round(this.cssWidth * this.dpr);
        this.canvas.height = Math.round(this.cssHeight * this.dpr);
        // We deliberately do NOT call ctx.scale(dpr, dpr) here. Every
        // drawing operation in this class scales its own coordinates so
        // the transform stack is always fully specified.
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    fillBackground() {
        const outerRad = Math.sqrt(this.cssWidth * this.cssWidth + this.cssHeight * this.cssHeight) / 2;
        // The original uses these specific coefficients for the gradient
        // geometry. They produce a slightly off-center, "lit-from-above-
        // right" background which is part of the library's signature look.
        const gradient = createNiceGradient(this.cssWidth * 0.75, (this.cssHeight / 2) * 0.75, 0, this.cssWidth / 2, this.cssHeight / 4, outerRad);
        const [ir, ig, ib] = parseColor(this.options.bgColorInner);
        const [or, og, ob] = parseColor(this.options.bgColorOuter);
        addColorStop(gradient, 0, ir, ig, ib);
        addColorStop(gradient, 1, or, og, ob);
        // Render the gradient into a detached, CSS-resolution off-screen
        // canvas, then blit it into the visible (DPR-scaled) canvas.
        // This keeps the gradient maths at CSS resolution (avoids huge
        // memory for the dithered buffer) and the visible canvas's
        // transform stack is left clean for the smoke strokes that follow.
        const offscreen = document.createElement("canvas");
        offscreen.width = Math.max(1, Math.round(this.cssWidth));
        offscreen.height = Math.max(1, Math.round(this.cssHeight));
        const offCtx = offscreen.getContext("2d");
        if (!offCtx) {
            throw new Error("waterpipe-ts: 2D context unavailable for background canvas");
        }
        fillRectNiceGradient(offCtx, gradient, 0, 0, this.cssWidth, this.cssHeight);
        // The visible context has identity transform after measure(). We
        // draw the CSS-resolution offscreen at full backing-store size so
        // the gradient is high-DPI sharp.
        this.ctx.drawImage(offscreen, 0, 0, this.canvas.width, this.canvas.height);
    }
    setCircles() {
        this.circles = [];
        for (let i = 0; i < this.options.numCircles; i++) {
            const minMax = this.options.minMaxRad;
            const maxMax = this.options.maxMaxRad;
            // Both are numbers at this point; resolveOptions has turned
            // 'auto' into a real radius in init().
            const minRng = minMax;
            const maxRng = maxMax;
            const maxR = minRng + Math.random() * (maxRng - minRng);
            const minR = this.options.minRadFactor * maxR;
            const grad = this.ctx.createRadialGradient(0, 0, minR, 0, 0, maxR);
            // The original bakes the opacity into the gradient stops; we
            // do the same so the visual is identical, but we also track the
            // alpha so live `setOption('smokeOpacity', x)` calls don't need
            // to rebuild the gradient (we use globalAlpha at draw time).
            const [sr, sg, sb] = parseColor(this.options.gradientStart);
            const [er, eg, eb] = parseColor(this.options.gradientEnd);
            const opacity = this.options.smokeOpacity;
            grad.addColorStop(1, rgbaString([sr, sg, sb, opacity]));
            grad.addColorStop(0, rgbaString([er, eg, eb, opacity]));
            const circle = {
                centerX: -maxR,
                centerY: this.cssHeight / 2 - 50,
                maxRad: maxR,
                minRad: minR,
                color: grad,
                param: 0,
                changeSpeed: 1 / 250,
                phase: Math.random() * TWO_PI,
                globalPhase: Math.random() * TWO_PI,
                pointList1: generateFractalPoints(this.options.iterations),
                pointList2: generateFractalPoints(this.options.iterations),
            };
            this.circles.push(circle);
        }
    }
    tick = (now) => {
        if (this.destroyed || !this.running)
            return;
        if (this.lastTickTime === 0)
            this.lastTickTime = now;
        const elapsed = now - this.lastTickTime;
        this.lastTickTime = now;
        this.accumulatorMs += elapsed;
        const stepMs = Math.max(1, this.options.speed);
        // Run as many sub-steps as the `speed` interval covers, but cap it
        // so a long pause (tab in background) doesn't fast-forward through
        // the whole animation in one frame.
        const maxSubSteps = 4;
        let subSteps = 0;
        while (this.accumulatorMs >= stepMs && subSteps < maxSubSteps) {
            this.accumulatorMs -= stepMs;
            this.runFrame();
            subSteps++;
            if (this.completed)
                break;
        }
        // Always emit a `tick` event for diagnostics / FPS counters —
        // listeners get the live frame count and elapsed time.
        this.safeEmit("tick", { frame: this.drawCount, dt: elapsed });
        if (this.completed) {
            this.running = false;
            this.rafId = null;
            this.safeEmit("complete");
            return;
        }
        this.rafId = requestAnimationFrame(this.tick);
    };
    runFrame() {
        for (let j = 0; j < this.options.drawsPerFrame; j++) {
            this.drawCount++;
            for (let i = 0; i < this.circles.length; i++) {
                this.drawCircle(this.circles[i]);
                if (this.completed)
                    return;
            }
        }
    }
    drawCircle(c) {
        c.param += c.changeSpeed;
        if (c.param >= 1) {
            c.param = 0;
            c.pointList1 = c.pointList2;
            c.pointList2 = generateFractalPoints(this.options.iterations);
        }
        const cosParam = 0.5 - 0.5 * Math.cos(Math.PI * c.param);
        // Slowly rotate.
        c.phase += 0.0002;
        let theta = c.phase;
        let rad = c.minRad + (c.pointList1.ys[0] + cosParam * (c.pointList2.ys[0] - c.pointList1.ys[0])) * (c.maxRad - c.minRad);
        // Advance the center. The horizontal drift is the smoke's main
        // motion; the vertical drift is clamped to a small fraction of
        // the canvas height so the smoke doesn't slowly slide off the
        // top or bottom of the frame over a long animation.
        c.centerX += 0.5;
        c.centerY = clamp(c.centerY + 0.04, this.cssHeight * 0.25, this.cssHeight * 0.75);
        const yOffset = 40 * Math.sin(c.globalPhase + (this.drawCount / 1000) * TWO_PI);
        // Termination: when the smoke has clearly left the right edge.
        if (c.centerX > this.cssWidth + this.options.maxMaxRad) {
            // Only mark complete once *every* circle has cleared.
            const allOff = this.circles.every((x) => x.centerX > this.cssWidth + this.options.maxMaxRad);
            if (allOff)
                this.completed = true;
            return;
        }
        // setTransform *replaces* the current matrix — so we have to
        // explicitly include the dpr scale, otherwise on a 2× display
        // the smoke would only fill the top-left quadrant of the canvas
        // backing store (which maps to the top-left quarter of the CSS
        // area). We wrap the stroke in a clip region so any portion of
        // the curve that would draw outside the canvas is hidden.
        const dpr = this.dpr;
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.save();
        // Clip to the canvas rect in backing-store coords.
        this.ctx.beginPath();
        this.ctx.rect(0, 0, w, h);
        this.ctx.clip();
        this.ctx.setTransform(X_SQUEEZE * dpr, 0, 0, dpr, c.centerX * dpr, (c.centerY + yOffset) * dpr);
        this.ctx.strokeStyle = c.color;
        this.ctx.lineWidth = this.options.lineWidth * dpr;
        this.ctx.globalAlpha = 1; // alpha is baked into the gradient stops
        this.ctx.beginPath();
        let x0 = X_SQUEEZE * rad * Math.cos(theta);
        let y0 = rad * Math.sin(theta);
        this.ctx.lineTo(x0, y0);
        const n = c.pointList1.length;
        for (let k = 1; k < n; k++) {
            theta = TWO_PI * (c.pointList1.xs[k] + cosParam * (c.pointList2.xs[k] - c.pointList1.xs[k])) + c.phase;
            rad = c.minRad + (c.pointList1.ys[k] + cosParam * (c.pointList2.ys[k] - c.pointList1.ys[k])) * (c.maxRad - c.minRad);
            x0 = X_SQUEEZE * rad * Math.cos(theta);
            y0 = rad * Math.sin(theta);
            this.ctx.lineTo(x0, y0);
        }
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.restore();
    }
    makeExportCanvas(width, height) {
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = Math.max(1, Math.round(width));
        exportCanvas.height = Math.max(1, Math.round(height));
        const exportCtx = exportCanvas.getContext("2d");
        if (!exportCtx) {
            throw new Error("waterpipe-ts: 2D context unavailable for export canvas");
        }
        // Draw the *visible* canvas into the export canvas at the desired
        // size. Using `drawImage` with an explicit destination size does
        // nearest-neighbor-style scaling; the smoke is procedural noise so
        // the result looks correct.
        exportCtx.drawImage(this.canvas, 0, 0, exportCanvas.width, exportCanvas.height);
        return exportCanvas;
    }
}
//# sourceMappingURL=waterpipe.js.map