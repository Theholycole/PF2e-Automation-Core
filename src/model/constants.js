// The shared plan model (docs/plan-model.md). Version 13 is the spell
// compiler's version 12 plus optional fields: every version-12 plan is valid.

export const MODEL_VERSION = 13;
export const ACCEPTED_MODEL_VERSIONS = Object.freeze([12, 13]);

export const DEGREES = Object.freeze(["criticalSuccess", "success", "failure", "criticalFailure"]);

export const AUTOMATION_LEVELS = Object.freeze(["automatic", "prompted", "guided", "unsafe", "unsupported"]);

// When a decision is asked (docs/plan-model.md section 3).
export const DECISION_PHASES = Object.freeze(["pre-cast", "pre-roll", "post-roll", "apply", "ongoing"]);

// ("automatic", 2026-10-15: no roll, every target's result the success row — the check family's, the ability and item modules' plans.)
export const CHECK_ROLLS = Object.freeze(["save", "skill", "attack", "perception", "flat", "counteract", "automatic"]);
export const SAVES = Object.freeze(["fortitude", "reflex", "will"]);

export const FREQUENCY_PERIODS = Object.freeze(["round", "turn", "minute", "10-minutes", "hour", "day", "encounter"]);
