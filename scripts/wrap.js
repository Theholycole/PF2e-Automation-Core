// Wrapping a PF2e or Foundry function (2026-10-11): through libWrapper when it's
// active, so other modules' wrappers of the same function are ordered with ours
// and libWrapper doesn't warn about a direct wrap; directly otherwise.
//
//   target   the function's path from the global scope, as libWrapper takes it
//            ("game.pf2e.Check.roll"), dots only
//   wrapper  libWrapper's form: (wrapped, ...args), `this` the caller's;
//            wrapped(...args) goes on to the original
//   type     "WRAPPER" when it always calls wrapped, "MIXED" when it may not
//
// Returns "libWrapper" or "direct".

export function libWrapperActive() {
    return Boolean(game.modules?.get?.("lib-wrapper")?.active && typeof globalThis.libWrapper?.register === "function");
}

export function wrapMethod(moduleId, target, wrapper, type = "WRAPPER") {
    if (libWrapperActive()) {
        globalThis.libWrapper.register(moduleId, target, wrapper, type);
        return "libWrapper";
    }
    const path = target.split(".");
    const key = path.pop();
    const owner = path.reduce((object, part) => object?.[part], globalThis);
    if (typeof owner?.[key] !== "function") throw new Error(`${target} is not a function.`);
    const original = owner[key];
    owner[key] = function (...args) {
        return wrapper.call(this, (...inner) => original.apply(this, inner), ...args);
    };
    return "direct";
}
