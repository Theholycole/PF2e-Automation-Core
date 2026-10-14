// The core's pure layer: no Foundry. Safe to import in Node, Web Workers and
// the Combat Simulator.

import { saveFamily } from "./families/save.js";
import { healingFamily } from "./families/healing.js";
import { directDamageFamily } from "./families/direct-damage.js";
import { effectFamily } from "./families/effect.js";
import { unsupportedFamily } from "./families/unsupported.js";
import { checkFamily } from "./families/check.js";
import { conditionNoteFamily, stabilizeFamily } from "./families/condition-note.js";

export * from "./model/constants.js";
export { validateSkeleton, readPlan } from "./model/plan.js";
export { validateDecision, makeDecision, byPhase, answer, pick } from "./model/decisions.js";
export { CHANGE_OPS, SIMULATED_OPS, validateChange, validateChanges } from "./model/changes.js";
export { DEGREE_NAMES, degreeIndex, degreeName } from "./model/degrees.js";
export { CONTEXT_SERVICES, missingServices, createSeededRoller } from "./io.js";
export { createRegistry } from "./registry.js";
export { parseDamage, parseDamagePools, addSteps, expectedDamage, rollDamage, formatDamage, formulaVariables } from "./model/dice.js";
export { parseDisable, routineActions, noMultipleAttackPenalty, mentionsStrike } from "./text/hazard-text.js";
export { drive, driveSync } from "./drive.js";
export { planWithActions, planWithVariant, variantFor, mechanicalVariants, healsTarget, hasVoidHealing, nativeOf, healingOf, sharedDamageOf } from "./families/shared.js";
export { HEALING_KIND, healingFamily, healingSteps, healingGaps } from "./families/healing.js";
export { DIRECT_DAMAGE_KIND, directDamageFamily, directDamageSteps, directDamageGaps, missileCount } from "./families/direct-damage.js";
export { EFFECT_KIND, effectFamily, effectSteps, effectGaps } from "./families/effect.js";
export { CONDITION_NOTE_KIND, STABILIZE_KIND, conditionNoteFamily, conditionNoteSteps, conditionNoteGaps, stabilizeFamily, stabilizeSteps, stabilizeGaps } from "./families/condition-note.js";
export { UNSUPPORTED_KIND, unsupportedFamily, unsupportedSteps, unsupportedGaps } from "./families/unsupported.js";
export { CHECK_KIND, checkFamily } from "./families/check.js";
export { SAVE_KIND, saveFamily, saveSteps, resolveSave, resolveSaveSync, saveGaps, sharedComponentsAt, heightenedAt } from "./families/save.js";

// The families the core resolves itself: shared PF2e mechanics.
export const CORE_FAMILIES = Object.freeze([saveFamily, healingFamily, directDamageFamily, effectFamily, unsupportedFamily, checkFamily, conditionNoteFamily, stabilizeFamily]);
