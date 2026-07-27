/**
 * waterpipe-ts — public entry point.
 *
 * Modern, dependency-free TypeScript port of waterpipe.js
 * (https://github.com/dragdropsite/waterpipe.js), a fractal-curve smoke
 * effect for HTML5 Canvas.
 *
 * Basic usage:
 *
 *   import { waterpipe } from "waterpipe-ts";
 *
 *   const canvas = document.querySelector("canvas")!;
 *   const effect = waterpipe(canvas, {
 *     gradientStart: "#ff8800",
 *     gradientEnd:   "#220000",
 *     smokeOpacity:  0.15,
 *   });
 *
 *   // Re-roll with new options:
 *   effect.setOptions({ numCircles: 3, iterations: 9 });
 *
 *   // Export a screenshot:
 *   await effect.download("background.png", 1920, 1080);
 *
 *   // Tear down:
 *   effect.destroy();
 */
export { WaterpipeImpl } from "./waterpipe.js";
export { generateFractalPoints } from "./fractal.js";
export { createNiceGradient, addColorStop, fillRectNiceGradient, gradientFromColors, } from "./nice-gradient.js";
export { parseColor, rgbaString } from "./colors.js";
import { WaterpipeImpl } from "./waterpipe.js";
/**
 * Attach the smoke effect to a `<canvas>` element.
 *
 * The original waterpipe.js accepts a jQuery selector or DOM element
 * wrapper; in this port we accept either a `<canvas>` element directly
 * or a `CSS selector` string that resolves to one. The function throws
 * if the target is not a `<canvas>`.
 */
export function waterpipe(target, options) {
    let canvas;
    if (typeof target === "string") {
        canvas = document.querySelector(target);
    }
    else {
        canvas = target;
    }
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
        throw new TypeError("waterpipe-ts: target must be an HTMLCanvasElement or a CSS selector that resolves to one");
    }
    return new WaterpipeImpl(canvas, options);
}
//# sourceMappingURL=index.js.map