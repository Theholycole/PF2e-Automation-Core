import test from "node:test";
import assert from "node:assert/strict";

import { categoryDice, soakedTemperature, temperatureFromFahrenheit } from "../src/environment/catalog.js";
import { AQUATIC_COMBAT, CONCEALED, OFF_GUARD, creatureEffect, ignoresWeather, effectiveWeather, feltTemperature, flatCheckFor, normalizeState, rangedInWind, sceneMovementCosts } from "../src/environment/weather.js";
import { boundaries, clockDamage, fatigueHours, lightningChances, turnStartDamage } from "../src/environment/ticks.js";
import { bandDC, disasterCard, easedFall, fallingDamage } from "../src/environment/disasters.js";
import { PF2E_FEATURES, featureRules, goesUp, ignoresFeature, sureFooted } from "../src/environment/terrain.js";

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

test("what a creature ignores of the weather: Ixamè's Eye through fog, a Cape of the Open Sky, Wintershot's Strikes", () => {
    const fog = normalizeState({ fog: { level: "thick" }, precipitation: { level: "downpour", kind: "rain" }, wind: { level: "strong" } });
    const eye = { weatherIgnores: [{ ignores: ["fog-mist"], source: "Ixamè's Eye" }] };
    assert.equal(rule(creatureEffect(fog, eye), "FlatModifier", "environment-sight").value, -3, "the downpour still hinders it");
    assert.equal(flatCheckFor(fog, { attacker: eye, distance: 30 }), null, "through the fog; the downpour conceals only past 60");
    assert.equal(flatCheckFor(fog, { attacker: eye, distance: 70 }).dc, 5);
    const cape = { weatherIgnores: [{ ignores: ["sight", "concealment", "wind-movement"], source: "Cape of the Open Sky" }] };
    const capeEffect = creatureEffect(normalizeState({ fog: { level: "thick" }, wind: { level: "severe" } }), { ...cape, speeds: { fly: 30 }, size: "sm" });
    assert.ok(!rule(capeEffect, "FlatModifier", "environment-sight"));
    assert.ok(!capeEffect.summary.some((line) => /Maneuver in Flight|On the ground/.test(line)));
    assert.equal(flatCheckFor(fog, { attacker: cape, distance: 200 }), null);
    const wintershot = { weatherIgnores: [{ ignores: ["precipitation", "wind-ranged"], weapon: "w1", windUpTo: 2, source: "Wintershot" }] };
    assert.deepEqual(rule(creatureEffect(fog, wintershot), "FlatModifier", "environment-wind").predicate, [{ not: "item:trait:impulse" }, { nor: ["item:id:w1"] }]);
    assert.ok(!rule(creatureEffect(normalizeState({ wind: { level: "severe" } }), wintershot), "FlatModifier", "environment-wind").predicate.some((entry) => entry.nor), "−3 is past its −2");
    assert.equal(flatCheckFor(normalizeState({ precipitation: { level: "downpour", kind: "rain" } }), { attacker: wintershot, distance: 70, weapon: "w1" }), null);
    assert.equal(flatCheckFor(normalizeState({ precipitation: { level: "downpour", kind: "rain" } }), { attacker: wintershot, distance: 70, weapon: "other" }).dc, 5);
    assert.ok(ignoresWeather(cape, "wind-movement"));
    assert.ok(!ignoresWeather(wintershot, "wind-ranged"), "only its weapon's Strikes");
});

test("protections (the item module's): the mildest of them and the gear, no chaining, nothing harsher; fatigue's most hours added", () => {
    const heat = normalizeState({ temperature: "extreme-heat" });
    const elixir = { counts: { "severe-heat": "mild-heat", "extreme-heat": "mild-heat" }, source: "Cooling Elixir" };
    const shade = { counts: { "mild-heat": "normal", "severe-heat": "normal" }, source: "Shade Hat" };
    assert.equal(feltTemperature(heat, { protections: [elixir] }), "mild-heat");
    assert.equal(feltTemperature(heat, { protections: [elixir, shade] }), "mild-heat", "the hat doesn't chain onto the elixir's mild heat");
    assert.equal(feltTemperature(normalizeState({ temperature: "severe-heat" }), { protections: [elixir, shade] }), "normal", "the mildest");
    const parka = { counts: { "incredible-cold": "extreme-cold", "extreme-cold": "severe-cold", "severe-cold": "normal" }, source: "Warming Parka" };
    assert.equal(feltTemperature(normalizeState({ temperature: "incredible-cold" }), { protections: [parka] }), "extreme-cold");
    assert.equal(feltTemperature(normalizeState({ temperature: "extreme-cold" }), { gear: { coldWeather: true }, protections: [parka] }), "severe-cold");
    assert.equal(feltTemperature(normalizeState({ temperature: "severe-cold" }), { protections: [{ counts: { "severe-cold": "incredible-cold" } }, { counts: { "severe-cold": "warm" } }] }), "severe-cold", "harsher or unknown: ignored");
    const soakedParka = normalizeState({ temperature: "mild-cold", precipitation: { level: "heavy", kind: "rain" } });
    assert.equal(feltTemperature(soakedParka, { protections: [parka] }), "normal", "soaked first: severe, which the parka negates");
    assert.equal(fatigueHours(normalizeState({}), { protections: [{ counts: {}, fatigueHours: 2 }, { counts: {}, fatigueHours: 1 }] }), 10);
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
    assert.equal(fallingDamage(5), 0, "5 feet or less: no damage");
    assert.deepEqual(easedFall(60), { feet: 60, damage: 30, before: 30, prone: true, by: null, reductions: [] });
    assert.deepEqual(easedFall(150, [{ shorter: 120, source: "Tumbler's Belt" }, { shorter: 30, source: "Talisman" }]), { feet: 30, damage: 15, before: 15, prone: true, by: "Tumbler's Belt", reductions: [] });
    assert.deepEqual(easedFall(100, [{ shorter: 120, source: "Tumbler's Belt" }]), { feet: 0, damage: 0, before: 0, prone: false, by: "Tumbler's Belt", reductions: [] });
    assert.deepEqual(easedFall(100, [{ shorter: 10 }, { noDamage: true, source: "Dragonaut's Wingsuit" }]), { feet: 0, damage: 0, before: 0, prone: false, by: "Dragonaut's Wingsuit", reductions: [] });
    // (Damage taken off — an Impact Foam Chassis: the largest one, for a fall at least its minFeet, up to the damage; after a shorter fall.)
    const foam = (reduceBy, source) => ({ reduceBy, minFeet: 10, itemUuid: `Item.${source}`, source });
    assert.deepEqual(easedFall(60, [foam(20, "Lesser"), foam(50, "Moderate")]), { feet: 60, damage: 0, before: 30, prone: false, by: "Moderate", reductions: [{ source: "Moderate", itemUuid: "Item.Moderate", amount: 30 }] });
    assert.deepEqual(easedFall(100, [foam(20, "Lesser")]), { feet: 100, damage: 30, before: 50, prone: true, by: "Lesser", reductions: [{ source: "Lesser", itemUuid: "Item.Lesser", amount: 20 }] });
    assert.deepEqual(easedFall(5, [foam(20, "Lesser")]).reductions, [], "a fall shorter than its minFeet");
    assert.deepEqual(easedFall(150, [{ shorter: 120, source: "Tumbler's Belt" }, foam(20, "Lesser")]), { feet: 30, damage: 0, before: 15, prone: false, by: "Tumbler's Belt, Lesser", reductions: [{ source: "Lesser", itemUuid: "Item.Lesser", amount: 15 }] });
    assert.deepEqual(easedFall(40, [{ noDamage: true, source: "Wingsuit" }, foam(20, "Lesser")]).reductions, [], "no damage to reduce");
    assert.deepEqual(easedFall(160, [{ shorter: 120, landsOnFeet: true, source: "Tumbler's Belt" }]), { feet: 40, damage: 20, before: 20, prone: false, by: "Tumbler's Belt", reductions: [] }, "hurt, but on its feet");
    assert.deepEqual(easedFall(60, [{ shorter: 25, source: "Gliding Membranes" }, { landsOnFeet: true, source: "Belt" }]), { feet: 35, damage: 17, before: 17, prone: false, by: "Gliding Membranes, Belt", reductions: [] });
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

test("ignoring a feature's difficult terrain: its own entries (not PF2e's all/all), greater too, sure-footed on ice, snow and undergrowth", () => {
    const winterstep = { difficult: [{ environment: "all", feature: "ice" }, { environment: "all", feature: "snow" }], greater: [] };
    assert.equal(ignoresFeature("ice", winterstep), "difficult");
    assert.equal(ignoresFeature("snow-deep", winterstep), "difficult");
    assert.equal(ignoresFeature("rubble", winterstep), "none");
    assert.equal(ignoresFeature("ice", { difficult: [{ environment: "all", feature: "all" }] }), "none", "PF2e applies all/all itself");
    assert.equal(ignoresFeature("ice", { difficult: [{ environment: "arctic", feature: "all" }] }), "difficult", "every feature of the arctic");
    assert.equal(ignoresFeature("bog-deep", { difficult: [{ environment: "arctic", feature: "all" }] }), "none");
    assert.equal(ignoresFeature("undergrowth-heavy", { difficult: [], greater: [{ environment: "all", feature: "undergrowth" }] }), "greater");
    assert.equal(sureFooted("ice", winterstep), true);
    assert.equal(sureFooted("snow-crust", winterstep), true);
    assert.equal(sureFooted("cave-floor", { difficult: [{ environment: "underground", feature: "all" }] }), false, "not a sure-footed feature");
    assert.equal(PF2E_FEATURES.roots, "undergrowth");
});

test("stairs: difficult only going up — the region's up direction", () => {
    const stairs = featureRules("stairs");
    assert.deepEqual(stairs.costs, {});
    assert.deepEqual(stairs.events.stairs, { cost: 2 });
    assert.equal(goesUp({ i: 5, j: 5 }, { i: 4, j: 5 }, "N"), true);
    assert.equal(goesUp({ i: 5, j: 5 }, { i: 6, j: 5 }, "N"), false);
    assert.equal(goesUp({ i: 5, j: 5 }, { i: 5, j: 6 }, "N"), false, "across the steps");
    assert.equal(goesUp({ i: 5, j: 5 }, { i: 4, j: 6 }, "N"), true, "a diagonal partly up");
    assert.equal(featureRules("stairs-giant").costs.walk, 3, "enormous stairs: both ways");
});

test("structures: condition from Hit Points, Force Open DCs, and the climb, force and lock cards (2026-10-26)", async () => {
    const { STRUCTURE_AC, climbCard, forceOpenCard, forceOpenDC, pickLockCard, structureCondition, structureOutcome, structureType } = await import("../src/environment/structures.js");
    assert.equal(STRUCTURE_AC, 10);
    assert.equal(structureType("portcullis-iron"), "portcullis");
    assert.equal(structureCondition(40, 20), "intact");
    assert.equal(structureCondition(20, 20), "broken", "at its Broken Threshold");
    assert.equal(structureCondition(0, 20), "destroyed");
    assert.equal(forceOpenDC("door-wood"), 15, "a stuck door");
    assert.equal(forceOpenDC("door-wood", { stuck: "very-stuck" }), 20);
    assert.equal(forceOpenDC("door-wood", { lock: "average" }), 30, "the lock's Thievery DC + 5");
    assert.equal(forceOpenDC("portcullis-iron"), 30);
    assert.equal(forceOpenDC("portcullis-wood", { lock: "simple" }), 25, "the higher of the lift and the lock");
    assert.equal(forceOpenDC("portcullis-iron", { lock: "poor" }), 30);
    assert.deepEqual(climbCard({ label: "Masonry wall", dc: 20 }).degrees.criticalFailure, { conditions: [{ slug: "prone" }] });
    assert.deepEqual(climbCard({ label: "Masonry wall", dc: 20, height: 15 }).degrees.criticalFailure, { falls: { feet: 15 } });
    const force = forceOpenCard({ label: "Wooden door", dc: 30, jammed: true, structure: "Scene.s.Token.t" });
    assert.deepEqual(force.check, { statistic: "athletics", dc: 30, basic: false, penalty: { value: -2, label: "Jammed" } });
    assert.deepEqual(force.degrees.success, { structure: { opens: true, breaks: true } });
    assert.equal(pickLockCard({ label: "Iron door", lock: "none" }), null);
    assert.equal(pickLockCard({ label: "Iron door", lock: "good" }).check.dc, 30);
    const lock = { lock: "poor", successes: 1, unlocked: false };
    assert.deepEqual(structureOutcome(lock, { lockSuccesses: 1 }), { next: { successes: 2, unlocked: true }, opens: false, breaks: false, unlocks: true });
    assert.deepEqual(structureOutcome({ lock: "good", successes: 0 }, { lockSuccesses: 2 }).next, { successes: 2 });
    assert.deepEqual(structureOutcome({ lock: "good", successes: 0 }, { opens: true, breaks: true }), { next: { unlocked: true }, opens: true, breaks: true, unlocks: true });
    assert.deepEqual(structureOutcome({ lock: null }, { jams: true }).next, { jammed: true });
});
