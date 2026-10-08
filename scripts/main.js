// pf2e-resolution-core in Foundry: the shared model and registry, the shared
// helpers, and the one copy of each shared PF2e patch (scripts/patches.js).
// A patch the spell module still installs itself is left to it until it
// switches over, so nothing is wrapped twice.

import * as core from "../src/index.js";
import * as runtimeUtils from "./runtime-utils.js";
import * as textPatterns from "../src/text/text-patterns.js";
import { installEarlyPatches, installPatches, patchesApi } from "./patches.js";
import * as forcedMovement from "./forced-movement.js";

export const CORE_ID = "pf2e-resolution-core";

const registry = core.createRegistry();
for (const family of core.CORE_FAMILIES) registry.registerFamily(family);

const api = Object.freeze({
    version: core.MODEL_VERSION,
    registry,
    model: core,
    patches: patchesApi,
    runtimeUtils,
    textPatterns,
    // Pushes and pulls (the user's grid rule, 2026-10-05).
    forcedMovement
});

// Content modules register families and providers in their own "init" hooks;
// the API exists from this module's "init" (dependencies load first).
Hooks.once("init", () => {
    game.modules.get(CORE_ID).api = api;
    Hooks.callAll("pf2eResolutionCoreReady", api);
});

Hooks.once("setup", installEarlyPatches);
Hooks.once("ready", installPatches);
