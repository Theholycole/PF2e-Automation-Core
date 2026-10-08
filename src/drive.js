// Drivers for a family's steps (a generator that yields requests and is sent
// the answers). drive() awaits each answer: live play, where rolls go through
// PF2e. driveSync() doesn't: the Combat Simulator, whose engine runs thousands
// of fights synchronously.
//
// Requests:
//   { type: "roll", statistic, options }  → io.roll(statistic, options): { degree, … }
//   { type: "damage", instance }          → io.damage(instance): number (the average, rounded down, without one)
//   { type: "choose", decision }          → io.choose(decision), checked against the options (its default without one)

import { pick } from "./model/decisions.js";
import { expectedDamage } from "./model/dice.js";

function request(step, io) {
    switch (step.type) {
        case "roll":
            if (typeof io.roll !== "function") throw new Error("This resolution rolls a check, and io has no roll().");
            return io.roll(step.statistic, step.options);
        case "damage":
            return io.damage ? io.damage(step.instance) : Math.max(0, Math.floor(expectedDamage(step.instance)));
        case "choose":
            return io.choose ? io.choose(step.decision) : undefined;
        default:
            throw new Error(`Unknown resolution request "${step.type}".`);
    }
}

const settle = (step, value) => (step.type === "choose" ? pick(step.decision, value) : value);

export async function drive(steps, io = {}) {
    let next = steps.next();
    while (!next.done) next = steps.next(settle(next.value, await request(next.value, io)));
    return next.value;
}

export function driveSync(steps, io = {}) {
    let next = steps.next();
    while (!next.done) {
        const value = request(next.value, io);
        if (value && typeof value.then === "function") throw new Error(`driveSync got a promise from io for a ${next.value.type} request; use drive().`);
        next = steps.next(settle(next.value, value));
    }
    return next.value;
}
