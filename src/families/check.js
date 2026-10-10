// The "check" family: the actor's skill against a target's DC (Demoralize,
// Trip, Grapple, Shove, Escape, and the monster riders that use them: Grab,
// Knockdown, Push). check: { roll: "skill", statistic, against: { dc:
// "target", statistic } }; outcomes are keyed from the actor's side, as attacks
// are, and effects may name recipient "self". The save family's steps resolve it. check.roll "automatic": no roll, every
// target's result the success row ("The target takes 3d8 fire damage", 2026-10-10).

import { drive } from "../drive.js";
import { saveGaps, saveSteps, validateSave } from "./save.js";

export const CHECK_KIND = "check";

export const checkFamily = Object.freeze({
    kind: CHECK_KIND,
    module: "pf2e-resolution-core",
    validate: validateSave,
    steps: saveSteps,
    resolve: (plan, context, io) => drive(saveSteps(plan, context), io),
    gaps: saveGaps
});
