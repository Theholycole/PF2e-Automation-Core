// The plan skeleton: what the core checks for every plan, and the reader that
// presents a version-12 plan in version-13 form. Each family checks its own
// resolution payload (registry.validatePlan).

import { ACCEPTED_MODEL_VERSIONS, AUTOMATION_LEVELS, CHECK_ROLLS, FREQUENCY_PERIODS, MODEL_VERSION, SAVES } from "./constants.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Issues with the shared skeleton, as [{ path, message }]. Empty when valid.
export function validateSkeleton(plan) {
    const issues = [];
    const add = (path, message) => issues.push({ path, message });
    if (!isObject(plan)) {
        add("", "A plan must be an object.");
        return issues;
    }
    if (!ACCEPTED_MODEL_VERSIONS.includes(plan.modelVersion)) add("modelVersion", `Model version ${plan.modelVersion} is not one of ${ACCEPTED_MODEL_VERSIONS.join(", ")}.`);
    if (!isObject(plan.source) || typeof plan.source.name !== "string" || !plan.source.name) add("source.name", "A plan names its source.");
    for (const key of ["activation", "targeting", "lifecycle"]) {
        if (plan[key] !== undefined && plan[key] !== null && !isObject(plan[key])) add(key, `${key} must be an object when present.`);
    }
    const resolution = plan.resolution;
    if (!isObject(resolution)) add("resolution", "A plan has a resolution.");
    else {
        if (typeof resolution.kind !== "string" || !resolution.kind) add("resolution.kind", "A resolution names its kind.");
        if (resolution.outcomes !== undefined && resolution.outcomes !== null && !isObject(resolution.outcomes)) add("resolution.outcomes", "Outcomes are keyed by degree.");
        if (resolution.check !== undefined && resolution.check !== null) validateCheck(resolution.check, add);
    }
    if (plan.automation !== undefined && plan.automation !== null) {
        if (!isObject(plan.automation) || !AUTOMATION_LEVELS.includes(plan.automation.level)) add("automation.level", `Automation level must be one of ${AUTOMATION_LEVELS.join(", ")}.`);
    }
    if (isObject(plan.trigger)) validateLimits(plan.trigger, add);
    return issues;
}

function validateCheck(check, add) {
    if (!isObject(check)) {
        add("resolution.check", "A check must be an object.");
        return;
    }
    if (check.roll !== undefined && !CHECK_ROLLS.includes(check.roll)) add("resolution.check.roll", `Check roll must be one of ${CHECK_ROLLS.join(", ")}.`);
    if (check.against !== undefined && check.against !== null) {
        if (!isObject(check.against) || typeof check.against.dc !== "string") add("resolution.check.against", "against names where its DC comes from.");
        else if (check.against.dc === "fixed" && !Number.isFinite(check.against.value)) add("resolution.check.against.value", "A fixed DC needs a value.");
    }
}

function validateLimits(trigger, add) {
    const frequency = trigger.frequency;
    if (isObject(frequency) && frequency.per !== undefined && !FREQUENCY_PERIODS.includes(frequency.per)) add("trigger.frequency.per", `Frequency period must be one of ${FREQUENCY_PERIODS.join(", ")}.`);
}

// "once per round", "once per day" and similar, for the structured frequency.
const FREQUENCY_TEXT = /^once per (round|turn|minute|10 minutes|hour|day|encounter)$/i;

function readFrequency(frequency) {
    if (frequency === null || frequency === undefined) return frequency ?? null;
    if (isObject(frequency) && frequency.per) return frequency;
    const raw = typeof frequency === "string" ? frequency : (frequency.raw ?? frequency.value ?? null);
    const match = typeof raw === "string" ? FREQUENCY_TEXT.exec(raw.trim()) : null;
    if (!match) return isObject(frequency) ? frequency : { raw };
    return { max: 1, per: match[1].toLowerCase().replace(" ", "-"), raw };
}

function readCheck(check) {
    if (!isObject(check) || check.roll) return check;
    // Version 12: a spell attack is the caster's spell attack against the target's AC;
    // anything else is the target's save against the source's DC.
    if (check.statistic === "spell-attack" || check.statistic === "strike") {
        // A spell attack, or a spell delivered by a Strike (Flowing Strike): both against AC.
        return { ...check, roll: "attack", against: { dc: "target", statistic: "ac" } };
    }
    if (SAVES.includes(check.statistic)) {
        const dc = check.dcSource === "source-actor" || !check.dcSource ? "source" : check.dcSource;
        return { ...check, roll: "save", against: { dc, statistic: "spell" } };
    }
    return check;
}

// A version-12 or version-13 plan, presented in version-13 form without
// changing the stored plan: check.roll and check.against filled in, simple
// frequencies structured. Stored plans are never rewritten (no renames).
export function readPlan(plan) {
    if (!isObject(plan)) return plan;
    const resolution = isObject(plan.resolution) ? { ...plan.resolution, check: readCheck(plan.resolution.check) } : plan.resolution;
    const trigger = isObject(plan.trigger) ? { ...plan.trigger, frequency: readFrequency(plan.trigger.frequency) } : plan.trigger;
    return { ...plan, storedModelVersion: plan.modelVersion, modelVersion: MODEL_VERSION, resolution, trigger };
}
