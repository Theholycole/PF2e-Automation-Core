import test from "node:test";
import assert from "node:assert/strict";

import { categoryDice, soakedTemperature, temperatureFromFahrenheit } from "../src/environment/catalog.js";
import { AQUATIC_COMBAT, CONCEALED, OFF_GUARD, creatureEffect, effectiveWeather, feltTemperature, flatCheckFor, normalizeState, rangedInWind, sceneMovementCosts } from "../src/environment/weather.js";
import { boundaries, clockDamage, fatigueHours, lightningChances, turnStartDamage } from "../src/environment/ticks.js";
import { bandDC, disasterCard, fallingDamage } from "../src/environment/disasters.js";
import { featureRules } from "../src/environment/terrain.js";

const rule = (effect, key, slug) => effect.rules.find((entry) => entry.key === key && (!slug || entry.slug === slug));

test("the GM's state: levels filled with their numbers, the GM's own distances kept, nonsense dropped", () => {
    const state = normalizeState({ fog: { level: "thick" }, wind: { level: "severe", direction: "NW" }, precipitation: { level: "heavy", kind: "snow", beyond: 90 }, smoke: { level: "nope" }, temperature: "extreme-cold" });
    assert.deepEqual(state.fog, { level: "thick", beyond: 10 });
    assert.equal(state.wind.flightDC, 20);
    assert.equal(state.wind.direction, "NW");
    assert.equal(state.precipitation.beyond, 90);
    assert.equal(state.smoke, null);
    assert.equal(state.temperature, "extreme-cold");
    assert.equal(normalizeState({ temperature: "balmy" }).temperature, "normal");
});

test("a thunderstorm brings its wind and rain at least; the GM's worse wind stays", () => {
    const storm = effectiveWeather(normalizeState({ thunderstorm: { level: "storm" } }));
    assert.equal(storm.wind.level, "strong");
    assert.equal(storm.precipitation.level, "heavy");
    assert.equal(storm.precipitation.kind, "rain");
    const gale = effectiveWeather(normalizeState({ thunderstorm: { level: "storm" }, wind: { level: "windstorm" }, precipitation: { level: "light", kind: "sleet" } }));
    assert.equal(gale.wind.level, "windstorm");
    assert.equal(gale.precipitation.level, "heavy");
    assert.equal(gale.precipitation.kind, "sleet");
});

test("fog: a sight penalty by its level, concealment past its distance, everyone concealed in pea soup", () => {
    const thick = creatureEffect(normalizeState({ fog: { level: "thick" } }), {});
    assert.equal(rule(thick, "FlatModifier", "environment-sight").value, -3);
    assert.deepEqual(rule(thick, "FlatModifier", "environment-sight").predicate, ["environment-sight", { not: "check:statistic:initiative" }]);
    assert.equal(rule(thick, "RollOption").value, true);
    assert.ok(!rule(thick, "GrantItem"));
    assert.ok(thick.summary.some((line) => /more than 10 feet away are concealed/.test(line)));
    const soup = creatureEffect(normalizeState({ fog: { level: "severe" } }), {});
    assert.equal(rule(soup, "GrantItem").uuid, CONCEALED);
    assert.equal(creatureEffect(normalizeState({ fog: { level: "mist" } }), {}), null, "mist does nothing in a fight");
});

test("precipitation: snow vision sees through snow; hail is heard, not seen; heavy rain soaks and chills", () => {
    const snow = normalizeState({ precipitation: { level: "downpour", kind: "snow" } });
    assert.equal(rule(creatureEffect(snow, {}), "FlatModifier", "environment-sight").value, -3);
    assert.equal(creatureEffect(snow, { snowVision: true }), null);
    const hail = creatureEffect(normalizeState({ precipitation: { level: "heavy", kind: "hail" } }), {});
    assert.equal(rule(hail, "FlatModifier", "environment-hearing").value, -2);
    assert.ok(!rule(hail, "FlatModifier", "environment-sight"));
    const rain = normalizeState({ precipitation: { level: "heavy", kind: "rain" }, temperature: "mild-cold" });
    assert.equal(feltTemperature(rain, {}), "severe-cold");
    assert.equal(feltTemperature(rain, { sheltered: true }), "normal");
    assert.equal(soakedTemperature("severe-cold"), "extreme-cold");
});

test("wind: hearing and physical ranged penalties, fliers' checks, a windstorm's impossible shots, the fly cost", () => {
    const strong = normalizeState({ wind: { level: "strong" } });
    const effect = creatureEffect(strong, {});
    assert.equal(rule(effect, "FlatModifier", "environment-wind").value, -2);
    assert.equal(rule(effect, "FlatModifier", "environment-wind").selector, "ranged-strike-attack-roll");
    assert.equal(rule(effect, "FlatModifier", "environment-hearing").value, -2);
    assert.deepEqual(sceneMovementCosts(strong), { fly: 2 });
    const storm = normalizeState({ wind: { level: "windstorm" } });
    assert.deepEqual(rangedInWind(storm), { possible: false, penalty: 0, label: "Windstorm" });
    const flier = creatureEffect(storm, { speeds: { fly: 30 }, size: "sm" });
    assert.ok(flier.summary.some((line) => /Maneuver in Flight \(DC 30\)/.test(line)));
    assert.ok(flier.summary.some((line) => /DC 20, −1 for its size|DC 20, -1 for its size/.test(line)));
    const gale = creatureEffect(normalizeState({ wind: { level: "severe" } }), { size: "med" });
    assert.ok(!gale.summary.some((line) => /On the ground/.test(line)), "a gale only troubles Small and Tiny creatures on the ground");
});

test("flat checks: concealed past the distance, hidden past murky water's sight, none for a precise non-visual sense", () => {
    const rain = normalizeState({ precipitation: { level: "downpour", kind: "rain" } });
    assert.equal(flatCheckFor(rain, { distance: 30 }), null);
    assert.equal(flatCheckFor(rain, { distance: 65 }).dc, 5);
    assert.equal(flatCheckFor(rain, { attacker: { senses: [{ type: "tremorsense", acuity: "imprecise", range: 60 }] }, distance: 65 }).dc, 5);
    assert.equal(flatCheckFor(rain, { attacker: { senses: [{ type: "echolocation", acuity: "precise", range: 120 }] }, distance: 65 }), null);
    const murky = normalizeState({ underwater: { level: "murky" } });
    assert.equal(flatCheckFor(murky, { distance: 15 }).dc, 11);
    assert.equal(flatCheckFor(murky, { distance: 10 }), null);
});

test("underwater: PF2e's Aquatic Combat effect, and breath for those who can't breathe water", () => {
    const water = normalizeState({ underwater: { level: "clear" } });
    const walker = creatureEffect(water, {});
    assert.equal(rule(walker, "GrantItem").uuid, AQUATIC_COMBAT);
    assert.ok(walker.summary.includes("Off-guard (no swim Speed)."));
    assert.ok(walker.summary.some((line) => /hold its breath \(underwater\)/.test(line)));
    const swimmer = creatureEffect(water, { speeds: { swim: 30 }, breathesWater: true });
    assert.equal(rule(swimmer, "GrantItem").uuid, AQUATIC_COMBAT, "PF2e's Effect leaves off-guard out for a swimmer itself");
    assert.ok(!swimmer.summary.some((line) => /breath|Off-guard/.test(line)));
});

test("temperature: °F to its category (humidity lowers the heat), gear and Environmental Endurance", () => {
    assert.equal(temperatureFromFahrenheit(-100), "incredible-cold");
    assert.equal(temperatureFromFahrenheit(100), "mild-heat");
    assert.equal(temperatureFromFahrenheit(100, { humid: true }), "severe-heat");
    const cold = normalizeState({ temperature: "extreme-cold" });
    assert.equal(feltTemperature(cold, { gear: { coldWeather: true } }), "severe-cold");
    assert.equal(feltTemperature(normalizeState({ temperature: "severe-cold" }), { gear: { coldWeather: true } }), "mild-cold");
    assert.equal(feltTemperature(normalizeState({ temperature: "extreme-heat" }), { gear: { coldWeather: true } }), "extreme-heat");
    assert.equal(feltTemperature(normalizeState({ temperature: "extreme-heat" }), { gear: { endurance: true } }), "mild-heat");
});

test("ticks: interval boundaries, temperature and ash on the clock, a sandstorm each turn, lightning each minute, travel fatigue", () => {
    assert.equal(boundaries(0, 0, 60, 60), 1);
    assert.equal(boundaries(0, 54, 60, 60), 1);
    assert.equal(boundaries(0, 60, 66, 60), 0);
    assert.equal(boundaries(30, 0, 3600, 600), 5, "630, 1230 … 3030");
    const incredible = normalizeState({ temperature: "incredible-cold" });
    assert.deepEqual(clockDamage(incredible, {}, { from: 54, to: 60 }), [{ label: "Incredible cold", category: "moderate", type: "cold", count: 1 }]);
    assert.deepEqual(clockDamage(incredible, {}, { from: 0, to: 54 }), []);
    assert.deepEqual(clockDamage(normalizeState({ temperature: "extreme-cold" }), {}, { from: 0, to: 1200 })[0].count, 2);
    assert.equal(clockDamage(normalizeState({ ash: { level: "thick" } }), {}, { from: 0, to: 120 })[0].count, 2);
    assert.deepEqual(turnStartDamage(normalizeState({ sandstorm: { level: "heavy" } }), {}), [{ label: "Heavy sandstorm", category: "minor", type: "slashing" }]);
    assert.deepEqual(turnStartDamage(normalizeState({ sandstorm: { level: "heavy", harm: "breath" } }), {}), []);
    assert.deepEqual(turnStartDamage(normalizeState({ sandstorm: { level: "mild" } }), {}), []);
    const storm = lightningChances(normalizeState({ thunderstorm: { level: "severe" } }), {}, { from: 0, to: 600 });
    assert.deepEqual(storm, [{ label: "Severe thunderstorm", chance: 200, category: "major", dc: null, count: 10 }]);
    assert.equal(fatigueHours(normalizeState({}), {}), 8);
    assert.equal(fatigueHours(normalizeState({ precipitation: { level: "moderate", kind: "rain" } }), {}), 4);
    assert.equal(fatigueHours(normalizeState({ temperature: "incredible-heat" }), {}), 2);
});

test("disasters: an avalanche buries all but a critical success; pyroclastic flows split to fire; lightning has no save unless the GM gives one", () => {
    const avalanche = disasterCard("avalanche", { dc: 30 });
    assert.deepEqual(avalanche.check, { statistic: "reflex", dc: 30, basic: false });
    assert.deepEqual(avalanche.damage, [{ formula: "10d6", type: "bludgeoning" }]);
    assert.equal(avalanche.degrees.criticalSuccess.buried, undefined);
    assert.deepEqual(avalanche.degrees.success, { damage: 0.5, buried: { snow: true } });
    assert.equal(avalanche.degrees.criticalFailure.damage, 1);
    assert.deepEqual(disasterCard("pyroclastic", { category: "massive", dice: 21 }).damage, [{ formula: "11d6", type: "bludgeoning" }, { formula: "10d6", type: "fire" }]);
    assert.deepEqual(disasterCard("lava-bomb").damage.map((part) => part.type), ["bludgeoning", "fire"]);
    const bolt = disasterCard("lightning", { category: "major" });
    assert.equal(bolt.check, null);
    assert.deepEqual(bolt.automatic, { damage: 1 });
    assert.equal(bolt.damage[0].formula, "10d6");
    assert.deepEqual(disasterCard("lightning", { save: true, dc: 25 }).check, { statistic: "reflex", dc: 25, basic: true });
    assert.equal(disasterCard("tornado").check.statistic, "athletics");
    assert.ok(disasterCard("tornado").degrees.criticalFailure.pickedUp);
    assert.equal(disasterCard("flames"), null);
    assert.deepEqual(disasterCard("wildfire-flames").degrees.failure.persistent, { formula: "5d6", type: "fire" });
    assert.equal(categoryDice("minor", 9), "2d6");
    assert.equal(bandDC(["expert", "legendary"]), 30);
    assert.equal(bandDC(["untrained", "trained"]), 10);
    assert.equal(fallingDamage(25), 12);
});

test("terrain: ice is difficult uneven ground, heavy undergrowth gives cover, lava burns each turn", () => {
    const ice = featureRules("ice");
    assert.deepEqual(ice.costs, { walk: 2, climb: 2 });
    assert.deepEqual(ice.events.balance, { dc: 20, narrow: false });
    assert.equal(ice.effect.rules[0].uuid, OFF_GUARD);
    assert.deepEqual(featureRules("ice", { dc: 25 }).events.balance.dc, 25);
    const heavy = featureRules("undergrowth-heavy");
    assert.equal(heavy.costs.walk, 3);
    assert.equal(heavy.effect.rules.find((entry) => entry.slug === "terrain-cover").value, 2);
    const lava = featureRules("lava");
    assert.deepEqual(lava.events.hazard, { formula: "20d6", type: "fire", when: "turn" });
    assert.ok(featureRules("ledge").effect.rules.some((entry) => entry.key === "Note"));
    assert.equal(featureRules("bogus"), null);
});
