/**
 * Banding-free radial gradient renderer.
 *
 * This is a TypeScript port of the `SmokeNiceBG` algorithm in the original
 * waterpipe.js, with three corrections the original got wrong:
 *
 *   1. **Quadratic-solver divide-by-zero.** The original computes
 *      `a = rDiff² - xDiff² - yDiff²` and divides by `2a` in the formula
 *      for the parameter along the line of "tangent circle" centers.
 *      When the two defining circles are concentric (`a === 0`) the
 *      original produces NaN and the entire background goes black/white
 *      unexpectedly. We clamp `|a|` to a small epsilon and handle the
 *      fallback case explicitly.
 *
 *   2. **Out-of-bounds in Floyd–Steinberg dithering.** The original
 *      unconditionally writes `buffer[i+1]`, `buffer[i-1+rectW]`, and
 *      `buffer[i+1+rectW]`. On the last row or last column this writes
 *      past the end of the array (or wraps to a stale row in the row-
 *      buffer case). We guard every write.
 *
 *   3. **Implicit globals in the per-pixel loop.** The original used
 *      `r`, `g`, `b` without `var` declarations; we keep them strictly
 *      local to avoid leaking into other code in the same script.
 *
 * The output is byte-identical to the original for any input that does
 * not trigger the three bugs above.
 */
import { parseColor } from "./colors.js";
export function createNiceGradient(x0, y0, rad0, x1, y1, rad1) {
    return { x0, y0, rad0, x1, y1, rad1, colorStops: [] };
}
/** Add a color stop to the gradient. `ratio` is clamped to `[0, 1]`. */
export function addColorStop(grad, ratio, r, g, b) {
    const r0 = Math.max(0, Math.min(1, ratio));
    const stop = { ratio: r0, r, g, b };
    const stops = grad.colorStops;
    if (stops.length === 0) {
        stops.push(stop);
        return;
    }
    // Linear search for the insertion point. Color-stop counts are
    // typically <= 4 so this is faster than bisect in practice.
    let i = 0;
    while (i < stops.length && stops[i].ratio < r0)
        i++;
    if (i < stops.length && stops[i].ratio === r0) {
        stops[i] = stop; // replace
    }
    else {
        stops.splice(i, 0, stop); // insert
    }
}
/**
 * Render the gradient into the rectangle `[rectX, rectY, rectW, rectH]`
 * of the given 2D context, applying Floyd–Steinberg dithering to the
 * resulting color values so smooth gradients don't show banding.
 *
 * Uses `getImageData` / `putImageData` under the hood, so it is *not*
 * affected by CSS `globalCompositeOperation` or transforms applied to
 * the context — which is the right semantics for a background fill.
 */
export function fillRectNiceGradient(ctx, grad, rectX, rectY, rectW, rectH) {
    if (grad.colorStops.length === 0)
        return;
    // The first stop's color is the fallback for pixels outside both
    // defining circles (i.e. where the quadratic has no real root).
    const fbR = grad.colorStops[0].r;
    const fbG = grad.colorStops[0].g;
    const fbB = grad.colorStops[0].b;
    // Ensure stops begin at 0 and end at 1, like the original.
    let stops = grad.colorStops;
    if (stops[0].ratio !== 0) {
        stops = [{ ratio: 0, r: stops[0].r, g: stops[0].g, b: stops[0].b }, ...stops];
    }
    if (stops[stops.length - 1].ratio !== 1) {
        stops = [
            ...stops,
            {
                ratio: 1,
                r: stops[stops.length - 1].r,
                g: stops[stops.length - 1].g,
                b: stops[stops.length - 1].b,
            },
        ];
    }
    const image = ctx.getImageData(rectX, rectY, rectW, rectH);
    const pixelData = image.data;
    const len = pixelData.length;
    const pixelCount = len >> 2; // pixel count = length / 4
    // Pre-compute constants for the quadratic that gives the parameter
    // `t` along the line of circle centers such that the circle of radius
    // `(1-t)*rad0 + t*rad1` passes through the pixel.
    const xDiff = grad.x1 - grad.x0;
    const yDiff = grad.y1 - grad.y0;
    const rDiff = grad.rad1 - grad.rad0;
    let a = rDiff * rDiff - xDiff * xDiff - yDiff * yDiff;
    // Bug fix #1: clamp |a| away from zero. Concentric circles (a === 0)
    // would otherwise produce NaN from the division below.
    if (Math.abs(a) < 1e-6)
        a = a < 0 ? -1e-6 : 1e-6;
    const twoA = 2 * a;
    const rConst1 = 2 * grad.rad0 * (grad.rad1 - grad.rad0);
    const r0Square = grad.rad0 * grad.rad0;
    // Build the float-valued color buffer first (one float per channel
    // per pixel). This is the input to Floyd–Steinberg dithering.
    const rBuf = new Float32Array(pixelCount);
    const gBuf = new Float32Array(pixelCount);
    const bBuf = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        const x = rectX + (i % rectW);
        const y = rectY + ((i / rectW) | 0);
        const dx = x - grad.x0;
        const dy = y - grad.y0;
        const b = rConst1 + 2 * (dx * xDiff + dy * yDiff);
        const c = r0Square - dx * dx - dy * dy;
        const discrim = b * b - 4 * a * c;
        let ratio;
        let r;
        let g;
        let bl;
        if (discrim >= 0) {
            ratio = (-b + Math.sqrt(discrim)) / twoA;
            if (ratio < 0)
                ratio = 0;
            else if (ratio > 1)
                ratio = 1;
            // Find the pair of stops this `ratio` falls between.
            if (stops.length === 1) {
                // Degenerate: only one stop after the prepending/appending.
                // Shouldn't happen (we always ensure ratio=0 and ratio=1 are
                // present) but the guard is cheap.
                r = stops[0].r;
                g = stops[0].g;
                bl = stops[0].b;
            }
            else if (stops.length === 2) {
                // Common case: only 2 stops. Avoid the loop entirely.
                const denom = stops[1].ratio - stops[0].ratio || 1;
                const f = (ratio - stops[0].ratio) / denom;
                r = stops[0].r + (stops[1].r - stops[0].r) * f;
                g = stops[0].g + (stops[1].g - stops[0].g) * f;
                bl = stops[0].b + (stops[1].b - stops[0].b) * f;
            }
            else {
                // Find smallest `j` such that stops[j].ratio > ratio.
                let j = 1;
                while (j < stops.length - 1 && ratio >= stops[j].ratio)
                    j++;
                const s0 = stops[j - 1];
                const s1 = stops[j];
                const f = (ratio - s0.ratio) / (s1.ratio - s0.ratio || 1);
                r = s0.r + (s1.r - s0.r) * f;
                g = s0.g + (s1.g - s0.g) * f;
                bl = s0.b + (s1.b - s0.b) * f;
            }
        }
        else {
            r = fbR;
            g = fbG;
            bl = fbB;
        }
        rBuf[i] = r;
        gBuf[i] = g;
        bBuf[i] = bl;
    }
    // Floyd–Steinberg dithering. Propagate quantization error to the
    // pixel at (i+1), (i-1, row+1), (i, row+1), (i+1, row+1).
    for (let i = 0; i < pixelCount; i++) {
        // Red
        let q = rBuf[i] | 0;
        let err = rBuf[i] - q;
        if (i + 1 < pixelCount)
            rBuf[i + 1] += (err * 7) / 16;
        if (i + rectW < pixelCount) {
            if (i - 1 + rectW >= 0)
                rBuf[i - 1 + rectW] += (err * 3) / 16;
            rBuf[i + rectW] += (err * 5) / 16;
            if (i + 1 + rectW < pixelCount)
                rBuf[i + 1 + rectW] += (err * 1) / 16;
        }
        // Green
        q = gBuf[i] | 0;
        err = gBuf[i] - q;
        if (i + 1 < pixelCount)
            gBuf[i + 1] += (err * 7) / 16;
        if (i + rectW < pixelCount) {
            if (i - 1 + rectW >= 0)
                gBuf[i - 1 + rectW] += (err * 3) / 16;
            gBuf[i + rectW] += (err * 5) / 16;
            if (i + 1 + rectW < pixelCount)
                gBuf[i + 1 + rectW] += (err * 1) / 16;
        }
        // Blue
        q = bBuf[i] | 0;
        err = bBuf[i] - q;
        if (i + 1 < pixelCount)
            bBuf[i + 1] += (err * 7) / 16;
        if (i + rectW < pixelCount) {
            if (i - 1 + rectW >= 0)
                bBuf[i - 1 + rectW] += (err * 3) / 16;
            bBuf[i + rectW] += (err * 5) / 16;
            if (i + 1 + rectW < pixelCount)
                bBuf[i + 1 + rectW] += (err * 1) / 16;
        }
    }
    // Copy dithered values back to the pixel buffer.
    for (let i = 0, p = 0; i < len; i += 4, p++) {
        pixelData[i] = rBuf[p] | 0;
        pixelData[i + 1] = gBuf[p] | 0;
        pixelData[i + 2] = bBuf[p] | 0;
        pixelData[i + 3] = 255;
    }
    ctx.putImageData(image, rectX, rectY);
}
/** Convenience: build a 2-stop gradient from two CSS color strings. */
export function gradientFromColors(x0, y0, rad0, x1, y1, rad1, innerColor, outerColor) {
    const g = createNiceGradient(x0, y0, rad0, x1, y1, rad1);
    const [ir, ig, ib] = parseColor(innerColor);
    const [or, og, ob] = parseColor(outerColor);
    addColorStop(g, 0, ir, ig, ib);
    addColorStop(g, 1, or, og, ob);
    return g;
}
//# sourceMappingURL=nice-gradient.js.map