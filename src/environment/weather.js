// A scene's weather — the GM's toggles, each at its level (catalog.js WEATHER) — and what it does to one creature: the rules of the
// Effect it holds while the weather lasts, whether a target is concealed or hidden from an attacker, and the temperature it feels.
// Pure: a creature is plain data ({ size, traits, senses, speeds, flying, breathesWater, snowVision, gear, sheltered }, scripts/sync.js).

import { DIRECTIONS, WEATHER, levelOf, protectedTemperature, soakedTemperature, temperatureOf } from "./catalog.js";

export const CONCEALED = "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W";
export const OFF_GUARD = "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg";
export const AQUATIC_COMBAT = "Compendium.pf2e.other-effects.Item.TPbr1kErAAJKBi3V";
export const REMAINING_AIR = "Compendium.pf2e.other-effects.Item.2u26bmArDPuoCljc";

const TOGGLES = ["fog", "precipitation", "wind", "thunderstorm", "smoke", "ash", "sandstorm", "underwater", "current"];

// The GM's state as kept on the scene, cleaned: each toggle null or { level, …its options }, with the level's own numbers filled in where
// the GM left them out. temperature: a catalog key; travel: { on, since } for fatigue.
export function normalizeState(raw = {}) {
    const state = { temperature: temperatureOf(raw?.temperature).key, travel: raw?.travel?.on ? { on: true, since: Number(raw.travel.since) || 0 } : null };
    for (const toggle of TOGGLES) {
        const entry = raw?.[toggle];
        const level = entry ? levelOf(toggle, entry.level) : null;
        if (!level) {
            state[toggle] = null;
            continue;
        }
        const next = { level: level.key };
        if (toggle === "precipitation") next.kind = WEATHER.precipitation.kinds[entry.kind] ? entry.kind : "rain";
        if (["fog", "precipitation", "smoke", "ash", "sandstorm"].includes(toggle)) next.beyond = feetOr(entry.beyond, level.beyond);
        if (toggle === "underwater") next.hiddenBeyond = feetOr(entry.hiddenBeyond, level.hiddenBeyond);
        if (toggle === "wind" || toggle === "current") next.direction = DIRECTIONS[entry.direction] ? entry.direction : toggle === "wind" ? "E" : "S";
        if (toggle === "wind") {
            next.flightDC = numberOr(entry.flightDC, level.flightDC ?? null);
            next.groundDC = numberOr(entry.groundDC, level.groundDC ?? null);
            next.blownFeet = numberOr(entry.blownFeet, level.blownFeet ?? null);
        }
        if (toggle === "current") next.feet = numberOr(entry.feet, level.feet);
        if (toggle === "thunderstorm") {
            next.chance = numberOr(entry.chance, WEATHER.thunderstorm.chance);
            next.dc = numberOr(entry.dc, WEATHER.thunderstorm.lightningDC);
        }
        if (toggle === "ash") {
            next.unbreathable = entry.unbreathable === true;
            next.chance = numberOr(entry.chance, WEATHER.ash.chance);
        }
        // (Near a wildfire: its heat each round, "minor fire damage every round at a reasonable distance from the front", up to massive within.)
        if (toggle === "smoke") {
            next.unbreathable = entry.unbreathable === true;
            next.heat = ["minor", "moderate", "major", "massive"].includes(entry.heat) ? entry.heat : null;
        }
        // (A heavy sandstorm: "deal minor slashing damage each round to those exposed to the sand, force creatures to hold their breath, or both" —
        // the GM's pick, both by default.)
        if (toggle === "sandstorm") next.harm = ["damage", "breath", "both"].includes(entry.harm) ? entry.harm : "both";
        state[toggle] = next;
    }
    return state;
}

const feetOr = (value, fallback) => (value === null || value === "" || value === undefined ? fallback ?? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback ?? null);
const numberOr = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : fallback);

// The weather in force: a thunderstorm brings its wind and rain at least (the GM's own wind or rain wins when it's worse).
export function effectiveWeather(state) {
    const storm = state.thunderstorm ? levelOf("thunderstorm", state.thunderstorm.level) : null;
    if (!storm) return state;
    // (Raised to the storm's level: that level's own numbers, the GM's kind and direction kept.)
    const atLeast = (toggle, current, key) => {
        const levels = WEATHER[toggle].levels.map((level) => level.key);
        if (current && levels.indexOf(current.level) >= levels.indexOf(key)) return current;
        return normalizeState({ [toggle]: { level: key, kind: current?.kind, direction: current?.direction } })[toggle];
    };
    return { ...state, wind: atLeast("wind", state.wind, storm.wind), precipitation: atLeast("precipitation", state.precipitation, storm.precipitation) };
}

// The sources of a sense's penalty for this creature: [{ toggle, label, penalty, beyond }].
export function senseSources(state, creature = {}) {
    const weather = effectiveWeather(state);
    const sight = [];
    const hearing = [];
    for (const toggle of ["fog", "smoke", "ash", "sandstorm"]) {
        if (!weather[toggle]) continue;
        const level = levelOf(toggle, weather[toggle].level);
        if (level.penalty) sight.push({ toggle, label: level.label, penalty: level.penalty, beyond: weather[toggle].beyond });
        if (level.hearing) hearing.push({ toggle, label: level.label, penalty: level.hearing });
    }
    if (weather.precipitation) {
        const level = levelOf("precipitation", weather.precipitation.level);
        const kind = WEATHER.precipitation.kinds[weather.precipitation.kind];
        const label = `${level.label} ${kind.label.toLowerCase()}`;
        const beyond = kind.conceals === false ? null : weather.precipitation.beyond;
        // (Snow Vision: falling snow doesn't hinder its sight.)
        if (kind.sense === "hearing") {
            if (level.penalty) hearing.push({ toggle: "precipitation", label, penalty: level.penalty });
        } else if (!(kind.snow && creature.snowVision) && (level.penalty || beyond !== null)) sight.push({ toggle: "precipitation", label, penalty: level.penalty, beyond });
    }
    if (weather.wind) {
        const level = levelOf("wind", weather.wind.level);
        if (level.penalty) hearing.push({ toggle: "wind", label: level.label, penalty: level.penalty });
    }
    return { sight, hearing };
}

// The nearest distance beyond which this creature's foes are concealed to it, from its weather (0: all of them; null: none).
// (Concealment is the target's: a creature in fog is concealed to the others; the GM's "beyond" applies to every viewer alike.)
export function concealedBeyond(state, creature = {}) {
    const beyonds = senseSources(state, creature).sight.map((source) => source.beyond).filter((value) => value !== null && value !== undefined);
    return beyonds.length ? Math.min(...beyonds) : null;
}

// Whether an attacker must roll a flat check against a target, and its DC: 11 hidden beyond the water's visibility, 5 concealed beyond the
// weather's distance (0: always). An attacker with a precise sense other than sight that reaches the target perceives it anyway.
export function flatCheckFor(state, { attacker = {}, target = {}, distance = 0 }) {
    if (preciseNonVisual(attacker, distance)) return null;
    const weather = effectiveWeather(state);
    if (weather.underwater && Number.isFinite(weather.underwater.hiddenBeyond) && distance > weather.underwater.hiddenBeyond) return { dc: 11, why: `${levelOf("underwater", weather.underwater.level).label}: beyond ${weather.underwater.hiddenBeyond} feet, hidden` };
    const sources = senseSources(state, attacker).sight.filter((source) => source.beyond !== null && source.beyond !== undefined && distance > source.beyond);
    if (!sources.length) return null;
    const nearest = sources.reduce((best, source) => (source.beyond < best.beyond ? source : best));
    return { dc: 5, why: nearest.beyond ? `${nearest.label}: beyond ${nearest.beyond} feet, concealed` : `${nearest.label}: concealed` };
}

const PRECISE_OTHER = new Set(["tremorsense", "echolocation", "wavesense", "lifesense", "thoughtsense", "spiritsense", "motion-sense", "heatsight"]);
function preciseNonVisual(attacker, distance) {
    return (attacker.senses ?? []).some((sense) => PRECISE_OTHER.has(sense.type) && sense.acuity === "precise" && (!Number.isFinite(sense.range) || sense.range >= distance));
}

// Whether a physical ranged attack is possible in the wind (a windstorm: no), and its penalty.
export function rangedInWind(state) {
    const weather = effectiveWeather(state);
    if (!weather.wind) return { possible: true, penalty: 0 };
    const level = levelOf("wind", weather.wind.level);
    return level.ranged === null ? { possible: false, penalty: 0, label: level.label } : { possible: true, penalty: level.ranged ?? 0, label: level.label };
}

// Soaked: heavy wet precipitation, unless the creature is sheltered.
export function soaked(state, creature = {}) {
    const weather = effectiveWeather(state);
    if (!weather.precipitation || creature.sheltered) return false;
    const level = levelOf("precipitation", weather.precipitation.level);
    return Boolean(level.soaks && WEATHER.precipitation.kinds[weather.precipitation.kind]?.wet);
}

// The temperature this creature feels: the scene's, a step colder soaked, eased by its gear or Environmental Endurance; a sheltered one
// feels none of it.
export function feltTemperature(state, creature = {}) {
    if (creature.sheltered) return "normal";
    let key = state.temperature ?? "normal";
    if (soaked(state, creature)) key = soakedTemperature(key);
    return protectedTemperature(key, { gear: Boolean(creature.gear?.coldWeather) && key.endsWith("cold"), endurance: Boolean(creature.gear?.endurance) });
}

// The air it must hold its breath against: underwater without water breathing, unbreathable ash or smoke, a heavy sandstorm that forces it.
export function breathlessIn(state, creature = {}) {
    const weather = effectiveWeather(state);
    const reasons = [];
    if (weather.underwater && !creature.breathesWater) reasons.push("underwater");
    if (!creature.sheltered && weather.ash?.unbreathable) reasons.push("volcanic ash");
    if (!creature.sheltered && weather.smoke?.unbreathable) reasons.push("smoke and heated air");
    if (!creature.sheltered && weather.sandstorm && levelOf("sandstorm", weather.sandstorm.level).damage && ["breath", "both"].includes(weather.sandstorm.harm)) reasons.push("the sandstorm");
    // (Buried with no air pocket: the GM's call on the disaster's card, scripts/burial.js.)
    if (creature.buriedAirless) reasons.push("buried without air");
    // (Creatures that don't breathe: PF2e's own "doesn't breathe" isn't a trait; constructs, undead and the like hold their breath forever.)
    if (creature.noBreath) return [];
    return reasons;
}

// The Effect a creature holds while the weather lasts: { name, summary: [lines], rules } — or null when the weather does nothing to it.
export function creatureEffect(state, creature = {}) {
    const weather = effectiveWeather(state);
    const rules = [];
    const lines = [];
    const names = [];
    const { sight, hearing } = senseSources(state, creature);
    const worst = (list) => list.reduce((best, source) => (source.penalty < best.penalty ? source : best), { penalty: 0 });

    const seeing = worst(sight);
    if (seeing.penalty < 0) {
        rules.push({ key: "RollOption", domain: "perception", option: "environment-sight", toggleable: true, value: true, label: "Perception check by sight" });
        rules.push({ key: "FlatModifier", selector: "perception", type: "circumstance", value: seeing.penalty, label: `${seeing.label} (sight)`, slug: "environment-sight", predicate: ["environment-sight", { not: "check:statistic:initiative" }] });
        lines.push(`${seeing.penalty} to Perception checks by sight (${seeing.label}).`);
    }
    const listening = worst(hearing);
    if (listening.penalty < 0) {
        rules.push({ key: "RollOption", domain: "perception", option: "environment-hearing", toggleable: true, value: false, label: "Perception check by hearing" });
        rules.push({ key: "FlatModifier", selector: "perception", type: "circumstance", value: listening.penalty, label: `${listening.label} (hearing)`, slug: "environment-hearing", predicate: ["environment-hearing", { not: "check:statistic:initiative" }] });
        lines.push(`${listening.penalty} to Perception checks by hearing (${listening.label}).`);
    }
    for (const source of [...sight, ...hearing]) if (!names.includes(source.label)) names.push(source.label);

    // Concealment: as a target, everyone in it (beyond 0) holds PF2e's condition (seen by any viewer — Snow Vision is the viewer's); as a
    // viewer, the targets past its distance (the module's flat check on attacks, scripts/attacks.js).
    if (concealedBeyond(state) === 0) {
        rules.push({ key: "GrantItem", uuid: CONCEALED, flag: "environmentConcealed", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } });
        lines.push("Concealed to every creature (DC 5 flat check to target it).");
    }
    const beyond = concealedBeyond(state, creature);
    if (beyond) {
        lines.push(`Creatures more than ${beyond} feet away are concealed to it (DC 5 flat check, rolled on attacks).`);
        rules.push({ key: "Note", selector: "attack-roll", title: "Weather", text: `Targets more than ${beyond} feet away are concealed: DC 5 flat check (rolled for you).`, predicate: [{ gt: ["target:distance", beyond] }] });
    }

    if (weather.wind) {
        const level = levelOf("wind", weather.wind.level);
        if (level.ranged === null) {
            rules.push({ key: "Note", selector: "ranged-strike-attack-roll", title: level.label, text: "Physical ranged attacks are impossible in a windstorm: the attack misses.", predicate: [{ not: "item:trait:impulse" }] });
            lines.push("Physical ranged attacks are impossible.");
        } else if (level.ranged) {
            rules.push({ key: "FlatModifier", selector: "ranged-strike-attack-roll", type: "circumstance", value: level.ranged, label: level.label, slug: "environment-wind", predicate: [{ not: "item:trait:impulse" }] });
            lines.push(`${level.ranged} to physical ranged attacks.`);
        }
        if (level.flightDC && creature.speeds?.fly) lines.push(`Flying: Maneuver in Flight (DC ${weather.wind.flightDC}) each round, or be blown ${weather.wind.blownFeet} feet ${weather.wind.direction}.`);
        if (level.groundDC && (!level.groundSizes || level.groundSizes.includes(creature.size))) {
            const sizePenalty = creature.size === "tiny" ? -2 : creature.size === "sm" ? -1 : 0;
            lines.push(`On the ground: Athletics (DC ${weather.wind.groundDC}${sizePenalty ? `, ${sizePenalty} for its size` : ""}) to move; a critical failure knocks it back and prone.`);
        }
        if (level.snuffs) lines.push(level.snuffs === "lanterns" ? "Wind snuffs out handheld flames, and even lanterns." : "Wind snuffs out handheld flames.");
        if (!names.includes(level.label)) names.push(level.label);
    }

    if (weather.precipitation) {
        const kind = WEATHER.precipitation.kinds[weather.precipitation.kind];
        if (kind.wet) lines.push("Wet precipitation douses unprotected flames.");
        if (soaked(state, creature)) lines.push("Soaked: the temperature counts as one step colder.");
    }

    if (weather.underwater) {
        const level = levelOf("underwater", weather.underwater.level);
        names.push(level.label);
        // (PF2e's own Effect: Aquatic Combat — off-guard without a swim Speed, −2 to bludgeoning and slashing attacks, halved range increments,
        // no fire, resistance 5 to acid and fire, the Underwater rune's exceptions.)
        rules.push({ key: "GrantItem", uuid: AQUATIC_COMBAT, flag: "environmentAquatic", allowDuplicate: false, onDeleteActions: { granter: "cascade", grantee: "cascade" } });
        if (!creature.speeds?.swim) lines.push("Off-guard (no swim Speed).");
        lines.push("Aquatic combat: −2 to bludgeoning and slashing attacks; ranged bludgeoning and slashing attacks miss; range increments halved; no fire; resistance 5 to acid and fire.");
        if (Number.isFinite(weather.underwater.hiddenBeyond)) lines.push(`Creatures more than ${weather.underwater.hiddenBeyond} feet away are hidden (DC 11 flat check, rolled on attacks).`);
    }

    if (weather.current) lines.push(`A ${weather.current.feet}-foot current moves it ${weather.current.direction} at the end of each of its turns.`);

    const felt = feltTemperature(state, creature);
    const temperature = temperatureOf(felt);
    if (temperature.damage) {
        const every = temperature.damage.every === 60 ? "every minute" : temperature.damage.every === 600 ? "every 10 minutes" : "every hour";
        lines.push(`${temperature.label}: ${temperature.damage.category} ${temperature.damage.type} damage ${every}.`);
        names.push(temperature.label.replace(/ \(.*\)$/, ""));
    } else if (temperature.key !== "normal" && state.temperature !== "normal") names.push(temperature.label.replace(/ \(.*\)$/, ""));

    if (weather.ash && !creature.sheltered) lines.push("Hot ash: minor fire damage every minute.");
    if (weather.sandstorm && levelOf("sandstorm", weather.sandstorm.level).damage && ["damage", "both"].includes(weather.sandstorm.harm) && !creature.sheltered) lines.push("Heavy sandstorm: minor slashing damage at the start of each of its turns.");
    if (weather.smoke?.heat && !creature.sheltered) lines.push(`Wildfire heat: ${weather.smoke.heat} fire damage at the start of each of its turns.`);
    const breath = breathlessIn(state, creature);
    if (breath.length) lines.push(`Must hold its breath (${breath.join(", ")}).`);
    if (weather.thunderstorm) lines.push("A very small chance each minute of a lightning strike.");

    if (!rules.length && !lines.length) return null;
    return { name: `Environment: ${names.length ? names.join(", ") : "weather"}`, summary: lines, rules };
}

// The movement costs the weather puts on the whole scene: { fly: 2|3 } in strong wind, { swim: 2|3 } against a current (the GM's region).
export function sceneMovementCosts(state) {
    const weather = effectiveWeather(state);
    const costs = {};
    const wind = weather.wind ? levelOf("wind", weather.wind.level) : null;
    if (wind?.flying) costs.fly = wind.flying;
    return costs;
}
