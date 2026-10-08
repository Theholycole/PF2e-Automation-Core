// The resolver's outside world (docs/plan-model.md section 4).
//
// io.roll(statistic, options) → { natural, total, degree }
//   A roller service, not a list of numbers: the live roller goes through
//   PF2e's Statistic.roll (with the d20 clamp, fortune, rerolls and degree
//   maps); the Combat Simulator and tests use createSeededRoller.
// io.damage(instance) → number   (an instance from parseDamage)
// io.choose(decision) → value
//
// context services: pure code can't read Foundry, so these come from the caller.

import { DEGREE_NAMES, degreeIndex } from "./model/degrees.js";
import { rollDamage } from "./model/dice.js";

export const CONTEXT_SERVICES = Object.freeze({
    statistic: "statistic(actor, slug) → { modifier, dc, rollOptions }",
    iwr: "iwr(actor) → { immunities, weaknesses, resistances }",
    distance: "distance(a, b) → feet",
    inArea: "inArea(actor, area) → boolean",
    blocked: "blocked(from, to) → boolean (walls stopping movement)"
});

// The services a context lacks, of those named (all by default).
export function missingServices(context, needed = Object.keys(CONTEXT_SERVICES)) {
    return needed.filter((name) => typeof context?.[name] !== "function");
}

// A roller (checks and damage) over a random source that returns numbers in [0, 1).
// Options: modifier, dc, fortune, misfortune (they cancel), minimumNatural
// (a clamp on the d20), degreeMap ({ success: "criticalSuccess", … }).
export function createSeededRoller(next) {
    const d20 = () => 1 + Math.floor(next() * 20);
    return {
        roll(statistic, { modifier = 0, dc = 10, fortune = false, misfortune = false, minimumNatural = 1, degreeMap = null } = {}) {
            let natural = d20();
            if (fortune !== misfortune) {
                const second = d20();
                natural = fortune ? Math.max(natural, second) : Math.min(natural, second);
            }
            natural = Math.max(natural, minimumNatural);
            const total = natural + modifier;
            let degree = DEGREE_NAMES[degreeIndex(total, dc, natural)];
            if (degreeMap?.[degree]) degree = degreeMap[degree];
            return { statistic, natural, total, dc, degree };
        },
        damage: (instance) => rollDamage(instance, next)
    };
}
