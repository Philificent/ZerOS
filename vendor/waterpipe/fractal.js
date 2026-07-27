/**
 * Fractal curve point generation.
 *
 * The original waterpipe.js implements midpoint-displacement subdivision on
 * a linked list of points, which is O(n²) in the number of iterations.
 * We keep the *same* visual output but back the points with two contiguous
 * `Float32Array`s (x and y), which gives us:
 *
 *   • O(n) total work (we walk the array forward, mutating in place)
 *   • Cache-friendly memory access
 *   • Zero per-step allocation
 *   • Easy to feed to Canvas2D line-strips if we ever want a WebGL port
 *
 * Output layout: a `PointList` is a flat pair of arrays of length
 * `2^iterations + 1`. The first point is always `(0, 1)`, the last is
 * always `(1, 1)`. Y values are normalized to the range [0, 1] after
 * generation, with the original's edge case (maxY === minY) preserved.
 *
 * The fractal's *character* is identical to the original: random
 * midpoint displacement of the y-coordinates, with the displacement
 * magnitude scaled by the segment width. The PRNG used is `Math.random`
 * to match the original's statistical appearance exactly.
 */
const MIN_ITERATIONS = 0;
const MAX_ITERATIONS = 14; // 2^14 + 1 = 16 385 points, plenty.
/**
 * Generate a fractal curve with `iterations` midpoint-displacement passes.
 *
 * @throws RangeError if `iterations` is outside `[0, 14]`.
 */
export function generateFractalPoints(iterations) {
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
        throw new RangeError(`waterpipe-ts: iterations must be an integer in [${MIN_ITERATIONS}, ${MAX_ITERATIONS}], got ${iterations}`);
    }
    const length = (1 << iterations) + 1;
    const xs = new Float32Array(length);
    const ys = new Float32Array(length);
    // Initialize endpoints.
    xs[0] = 0;
    ys[0] = 1;
    xs[length - 1] = 1;
    ys[length - 1] = 1;
    // Midpoint displacement. At iteration k there are 2^k segments. We
    // step through them in pairs of (start, end) and insert a midpoint
    // between them. Each new midpoint's y is the average of its neighbours
    // plus a uniformly-distributed perturbation scaled by the segment width.
    let minY = 1;
    let maxY = 1;
    let step = length - 1; // distance between endpoints we treat as "neighbours" this round
    while (step > 1) {
        const half = step >> 1;
        for (let i = 0; i + step < length; i += step) {
            const left = i;
            const right = i + step;
            const mid = i + half;
            const dx = xs[right] - xs[left];
            const newY = 0.5 * (ys[left] + ys[right]) + dx * (Math.random() * 2 - 1);
            xs[mid] = 0.5 * (xs[left] + xs[right]);
            ys[mid] = newY;
            if (newY < minY)
                minY = newY;
            else if (newY > maxY)
                maxY = newY;
        }
        step = half;
    }
    // Normalize to [0, 1]. The original preserves the degenerate case
    // (maxY == minY) by setting every y to 1. We use a two-pass scan
    // with explicit clamping to defend against floating-point round-off
    // where `rate * (maxY - minY)` is computed as 1 ± ε.
    if (maxY !== minY) {
        const rate = 1 / (maxY - minY);
        for (let i = 0; i < length; i++) {
            const y = rate * (ys[i] - minY);
            ys[i] = y < 0 ? 0 : y > 1 ? 1 : y;
        }
    }
    else {
        for (let i = 0; i < length; i++)
            ys[i] = 1;
    }
    return { length, xs, ys };
}
//# sourceMappingURL=fractal.js.map