// Change ops: what resolving a plan does (docs/plan-model.md section 4). The
// live apply layer turns them into document and scene updates after the
// confirmation card; the Combat Simulator applies what it models.

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasTarget = (change) => change.target !== undefined && change.target !== null;

// Required fields per op, beyond `op` itself.
const REQUIRED = Object.freeze({
    damage: (c) => hasTarget(c) && Array.isArray(c.instances) && c.instances.every((i) => isObject(i) && typeof i.type === "string" && Number.isFinite(i.amount)),
    heal: (c) => hasTarget(c) && Number.isFinite(c.amount),
    tempHp: (c) => hasTarget(c) && Number.isFinite(c.amount),
    condition: (c) => hasTarget(c) && typeof c.slug === "string" && (c.value === undefined || c.value === null || Number.isFinite(c.value)),
    effect: (c) => hasTarget(c) && c.effect !== undefined,
    end: (c) => hasTarget(c) && c.what !== undefined,
    item: (c) => hasTarget(c) && ["create", "update", "delete"].includes(c.action),
    move: (c) => hasTarget(c) && ["push", "pull", "stride"].includes(c.kind) && Number.isFinite(c.distance),
    teleport: (c) => hasTarget(c) && c.to !== undefined,
    elevate: (c) => hasTarget(c) && Number.isFinite(c.delta),
    size: (c) => hasTarget(c) && typeof c.size === "string",
    ownership: (c) => hasTarget(c) && c.owner !== undefined,
    spawn: (c) => ["token", "actor"].includes(c.what) && c.data !== undefined,
    scene: (c) => ["region", "wall", "light"].includes(c.what) && typeof c.action === "string",
    ongoing: (c) => ["start", "advance", "end"].includes(c.action) && c.record !== undefined,
    followUp: (c) => c.plan !== undefined,
    affliction: (c) => hasTarget(c) && c.data !== undefined,
    resource: (c) => hasTarget(c) && typeof c.key === "string" && Number.isFinite(c.delta),
    // Death effects: at once, or (ifReducedTo) when this resolution's damage takes the target to that HP.
    death: (c) => hasTarget(c) && (c.ifReducedTo === undefined || Number.isFinite(c.ifReducedTo)),
    note: (c) => ["gm", "all"].includes(c.audience ?? "gm") && typeof c.text === "string"
});

export const CHANGE_OPS = Object.freeze(Object.keys(REQUIRED));

export function validateChange(change) {
    if (!isObject(change)) return ["A change must be an object."];
    const check = REQUIRED[change.op];
    if (!check) return [`Unknown change op "${change.op}".`];
    return check(change) ? [] : [`The ${change.op} change is missing or has invalid fields.`];
}

export function validateChanges(changes) {
    const issues = [];
    (changes ?? []).forEach((change, index) => {
        for (const message of validateChange(change)) issues.push({ path: `changes.${index}`, message });
    });
    return issues;
}

// Ops the Combat Simulator applies to its state; the rest are gaps there.
export const SIMULATED_OPS = Object.freeze(["damage", "heal", "tempHp", "condition", "effect", "end", "move", "resource", "death"]);
