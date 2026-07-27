/**
 * Tiny, type-safe event emitter. ~20 lines, no dependencies.
 *
 * Intentionally not a class — used as a private mixin by the controller.
 * We keep the surface area minimal so a 4 kB library doesn't drag in
 * `node:events`.
 */
export function createEmitter() {
    const listeners = new Map();
    return {
        on(event, handler) {
            let set = listeners.get(event);
            if (!set) {
                set = new Set();
                listeners.set(event, set);
            }
            set.add(handler);
        },
        off(event, handler) {
            listeners.get(event)?.delete(handler);
        },
        emit(event, payload) {
            const set = listeners.get(event);
            if (!set || set.size === 0)
                return;
            // Snapshot to defend against handlers that mutate the set.
            for (const handler of Array.from(set)) {
                try {
                    handler(event, payload);
                }
                catch (err) {
                    // Never let a listener crash the animation loop.
                    // eslint-disable-next-line no-console
                    console.error(`[waterpipe-ts] listener for "${event}" threw:`, err);
                }
            }
        },
        clear() {
            listeners.clear();
        },
    };
}
//# sourceMappingURL=events.js.map