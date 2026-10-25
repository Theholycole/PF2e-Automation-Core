// What the weather deals out as time passes: damage at the start of each turn (a heavy sandstorm, a wildfire's heat), damage at its
// interval on the world clock (temperature, hot ash — the user: per round and per minute in a fight, 10 minutes and hours on the world
// clock, 2026-10-25), the chance of lightning each minute, and fatigue on a journey. Pure.

import { BURIAL, WEATHER, levelOf, temperatureOf } from "./catalog.js";
import { breathlessIn, effectiveWeather, feltTemperature } from "./weather.js";

// The hits of an interval that fall within (from, to], counted from the moment it started.
export function boundaries(since, from, to, every) {
    if (!(every > 0) || !(to > from)) return 0;
    const start = Number(since) || 0;
    const first = Math.max(1, Math.floor((from - start) / every) + 1);
    const last = Math.floor((to - start) / every);
    return Math.max(0, last - first + 1);
}

// Damage at the start of each of its turns: [{ label, category, type }].
export function turnStartDamage(state, creature = {}) {
    if (creature.sheltered) return [];
    const weather = effectiveWeather(state);
    const hits = [];
    const sand = weather.sandstorm ? levelOf("sandstorm", weather.sandstorm.level) : null;
    if (sand?.damage && ["damage", "both"].includes(weather.sandstorm.harm)) hits.push({ label: sand.label, category: sand.damage.category, type: sand.damage.type });
    if (weather.smoke?.heat) hits.push({ label: "Wildfire heat", category: weather.smoke.heat, type: "fire" });
    return hits;
}

// When each kind of weather started: a number for all of them, or { temperature, ash, thunderstorm }.
const sinceOf = (since, key) => (typeof since === "number" ? since : Number(since?.[key]) || 0);

// Damage on the world clock between two times: [{ label, category, type, count }], from when the weather started (since).
export function clockDamage(state, creature = {}, { from, to, since = 0 }) {
    const hits = [];
    const temperature = temperatureOf(feltTemperature(state, creature));
    if (temperature.damage) {
        const count = boundaries(sinceOf(since, "temperature"), from, to, temperature.damage.every);
        if (count) hits.push({ label: temperature.label.replace(/ \(.*\)$/, ""), category: temperature.damage.category, type: temperature.damage.type, count });
    }
    const weather = effectiveWeather(state);
    if (weather.ash && !creature.sheltered) {
        const count = boundaries(sinceOf(since, "ash"), from, to, WEATHER.ash.damage.every);
        if (count) hits.push({ label: "Hot volcanic ash", category: WEATHER.ash.damage.category, type: WEATHER.ash.damage.type, count });
    }
    return hits;
}

// Burial's damage on the world clock: minor bludgeoning each minute, and minor cold under snow.
export function burialDamage({ from, to, since = 0, snow = false }) {
    const count = boundaries(since, from, to, BURIAL.damage.every);
    if (!count) return [];
    return [{ label: "Buried", category: BURIAL.damage.category, type: BURIAL.damage.type, count }, ...(snow ? [{ label: "Buried in snow", category: BURIAL.snow.category, type: BURIAL.snow.type, count }] : [])];
}

// Lightning's chances on the world clock: [{ label, chance (one in N), category, dc, count }] — each exposed creature rolls each minute.
export function lightningChances(state, creature = {}, { from, to, since = 0 }) {
    if (creature.sheltered) return [];
    const weather = effectiveWeather(state);
    const chances = [];
    if (weather.thunderstorm) {
        const storm = levelOf("thunderstorm", weather.thunderstorm.level);
        const count = boundaries(sinceOf(since, "thunderstorm"), from, to, 60);
        if (count && weather.thunderstorm.chance > 0) chances.push({ label: storm.label, chance: weather.thunderstorm.chance, category: storm.lightning, dc: weather.thunderstorm.dc, count });
    }
    if (weather.ash) {
        const count = boundaries(sinceOf(since, "ash"), from, to, 60);
        if (count && weather.ash.chance > 0) chances.push({ label: "Ash lightning", chance: weather.ash.chance, category: WEATHER.ash.lightning, dc: WEATHER.ash.lightningDC, count });
    }
    return chances;
}

// Travel fatigue: the hours of travel before a creature becomes fatigued — the temperature's, or 4 in anything heavier than drizzle or light
// snowfall.
export function fatigueHours(state, creature = {}) {
    let hours = temperatureOf(feltTemperature(state, creature)).fatigueHours;
    const weather = effectiveWeather(state);
    if (weather.precipitation && weather.precipitation.level !== "light") hours = Math.min(hours, 4);
    return hours;
}

// Whether the weather makes a creature hold its breath (a fight's breath tracker, scripts/breath.js).
export const mustHoldBreath = (state, creature) => breathlessIn(state, creature).length > 0;
