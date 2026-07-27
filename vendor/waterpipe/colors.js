/**
 * Color parsing utilities.
 *
 * The original waterpipe.js only accepted `#rrggbb` and would fall over on
 * `#fff`, `rgb(...)`, or named colors. We accept anything the browser can
 * parse by deferring to a hidden probe `<canvas>`. We never touch the DOM
 * directly — we use the `2d` context to canonicalize any input to an
 * `[r, g, b, a]` tuple.
 *
 * Each call uses its *own* 1×1 probe canvas so concurrent callers cannot
 * race. The cost is one canvas allocation per parse, but `parseColor` is
 * only called from `setOptions` (i.e. on user-initiated option changes,
 * not in the animation hot loop), so the cost is invisible.
 *
 * `transparent`, the empty string, or any unparseable value resolves to
 * `[0, 0, 0, 0]` (i.e. fully transparent black). Callers should validate
 * option strings before calling.
 */
/**
 * Parse any CSS color string to an `[r, g, b, a]` tuple.
 *
 * Leading/trailing whitespace is tolerated. The result is always
 * in `[0, 255]` for the channels and `[0, 255]` for alpha (the canvas
 * composites onto an opaque buffer).
 *
 * Returns `[0, 0, 0, 0]` for unparseable input rather than throwing —
 * the colour shows up as transparent rather than crashing the
 * animation. Use the strict overload if you need to surface bad
 * input to the user.
 */
export function parseColor(input) {
    if (typeof input !== "string") {
        return [0, 0, 0, 0];
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
        return [0, 0, 0, 0];
    }
    // Fresh per-call canvas. 1×1, no DOM-attached.
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
        return [0, 0, 0, 0];
    }
    // Clear by painting transparent first so a prior colour on the
    // probe can't bleed in. Note: in a fresh canvas there's no prior
    // state, but this defends against any browser quirk.
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, 1, 1);
    try {
        ctx.fillStyle = trimmed;
    }
    catch {
        return [0, 0, 0, 0];
    }
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const r = data[0] ?? 0;
    const g = data[1] ?? 0;
    const b = data[2] ?? 0;
    const a = data[3] ?? 0;
    return [r, g, b, a];
}
/** Serialize an `[r,g,b,a]` tuple to a `rgba(...)` string. */
export function rgbaString(rgb) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${rgb[3]})`;
}
//# sourceMappingURL=colors.js.map