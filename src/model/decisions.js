// Typed, phased decisions (docs/plan-model.md section 3). Live play asks them
// on the confirmation card; the Combat Simulator's planner answers them.

import { DECISION_PHASES } from "./constants.js";

const AUDIENCES = new Set(["gm", "owner"]);

export function validateDecision(decision) {
    const issues = [];
    const add = (path, message) => issues.push({ path, message });
    if (!decision || typeof decision !== "object") return [{ path: "", message: "A decision must be an object." }];
    if (typeof decision.id !== "string" || !decision.id) add("id", "A decision has a stable id.");
    if (!DECISION_PHASES.includes(decision.phase)) add("phase", `Phase must be one of ${DECISION_PHASES.join(", ")}.`);
    if (typeof decision.question !== "string" || !decision.question) add("question", "A decision asks a question.");
    if (!Array.isArray(decision.options) || decision.options.length < 1) add("options", "A decision offers at least one option.");
    else decision.options.forEach((option, index) => {
        if (!option || !("value" in option) || typeof option.label !== "string") add(`options.${index}`, "An option has a value and a label.");
    });
    if (decision.default !== undefined && Array.isArray(decision.options) && !decision.options.some((option) => option?.value === decision.default)) {
        add("default", "The default must be one of the options.");
    }
    if (decision.audience !== undefined && !AUDIENCES.has(decision.audience)) add("audience", "Audience is gm or owner.");
    return issues;
}

export function makeDecision(decision) {
    const issues = validateDecision(decision);
    if (issues.length) throw new Error(`Invalid decision ${decision?.id ?? "(no id)"}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    return Object.freeze({ audience: "gm", ...decision });
}

// Decisions in the order they're asked.
export function byPhase(decisions) {
    return [...decisions].sort((a, b) => DECISION_PHASES.indexOf(a.phase) - DECISION_PHASES.indexOf(b.phase));
}

// A chosen value if it's one of the options, else the default, then the first option.
export function pick(decision, value) {
    if (value !== undefined && decision.options.some((option) => option.value === value)) return value;
    return decision.default !== undefined ? decision.default : decision.options[0].value;
}

// Answers a decision with io.choose, falling back as pick does.
export async function answer(decision, choose) {
    return pick(decision, choose ? await choose(decision) : undefined);
}
