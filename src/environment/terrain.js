// The ground a region (or a whole scene) is made of — GM Core's environmental features (catalog.js FEATURES) — as what the region does:
// PF2e's movement costs and environment types, the Effect a creature holds while inside (off-guard on uneven ground or a narrow surface,
// cover), and its events (Balance on entering, hazard damage, a current's push). Pure.

import { FEATURES, SIMPLE_DCS, categoryDice } from "./catalog.js";
import { bandDC } from "./disasters.js";

export const MOVE_ACTIONS = ["walk", "climb", "burrow"];

// One feature, with the GM's DC (the band's middle otherwise): { key, label, costs, environment, effect, events, summary }.
export function featureRules(key, { dc = null } = {}) {
    const feature = FEATURES[key];
    if (!feature) return null;
    const checkDC = Number(dc) || bandDC(feature.band);
    const costs = feature.cost ? Object.fromEntries(MOVE_ACTIONS.filter((action) => action !== "burrow").map((action) => [action, feature.cost])) : {};
    if (feature.current || feature.swim) costs.swim = feature.current ? 2 : 1;
    const effectRules = [];
    const summary = [];
    if (feature.cost) summary.push(feature.cost === 3 ? "Greater difficult terrain." : "Difficult terrain.");
    if (feature.uneven || feature.narrow) {
        effectRules.push({ key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg", flag: "terrainOffGuard", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } });
        summary.push(`${feature.narrow ? "A narrow surface" : "Uneven ground"}: Balance (Acrobatics DC ${checkDC}) to move on it; off-guard while on it.`);
        if (feature.narrow) {
            effectRules.push({ key: "Note", selector: ["ac", "saving-throw"], title: feature.label, text: `On a narrow surface: hit by an attack or failing a save, a Reflex save (DC ${checkDC}) or fall.` });
            summary.push(`Hit by an attack or failing a save there: Reflex (DC ${checkDC}) or fall.`);
        }
    }
    if (feature.cover === "standard") {
        effectRules.push({ key: "FlatModifier", selector: "ac", type: "circumstance", value: 2, label: `Cover (${feature.label})`, slug: "terrain-cover" });
        effectRules.push({ key: "FlatModifier", selector: "reflex", type: "circumstance", value: 2, label: `Cover (${feature.label})`, slug: "terrain-cover-reflex", predicate: ["area-effect"] });
        effectRules.push({ key: "FlatModifier", selector: "stealth", type: "circumstance", value: 2, label: `Cover (${feature.label})`, slug: "terrain-cover-stealth" });
        summary.push("Standard cover (+2 AC, Reflex against areas, Stealth).");
    } else if (feature.cover === "take") summary.push("A creature here can Take Cover.");
    if (feature.climb) summary.push(`Climb (Athletics DC ${checkDC}) to go up it.`);
    if (feature.swim) summary.push("Too deep to stand in: Swim to move.");
    if (feature.hazard) {
        const dice = categoryDice(feature.hazard.category);
        summary.push(`Hazardous: ${dice} ${feature.hazard.type} damage ${feature.hazard.when === "enter" ? "on moving into it" : "at the start of each turn in it"}${feature.hazard.persistent ? `, and ${categoryDice(feature.hazard.persistent.category)} persistent ${feature.hazard.persistent.type}` : ""}.`);
    }
    if (feature.part) summary.push(`Diplomacy, Intimidation or Performance (DC ${checkDC}) can part it.`);
    if (feature.explodes) summary.push(`Explodes when exposed to flame: ${categoryDice(feature.explodes.category)} ${feature.explodes.type} damage.`);
    if (feature.note) summary.push(feature.note);
    const events = {
        ...(feature.uneven || feature.narrow ? { balance: { dc: checkDC, narrow: Boolean(feature.narrow) } } : {}),
        ...(feature.hazard ? { hazard: { formula: categoryDice(feature.hazard.category), type: feature.hazard.type, when: feature.hazard.when, ...(feature.hazard.persistent ? { persistent: { formula: categoryDice(feature.hazard.persistent.category), type: feature.hazard.persistent.type } } : {}) } } : {}),
        ...(feature.part ? { part: { dc: checkDC } } : {}),
        ...(feature.explodes ? { explodes: { formula: categoryDice(feature.explodes.category), type: feature.explodes.type } } : {}),
        ...(feature.current ? { current: true } : {})
    };
    return { key, label: feature.label, dc: checkDC, costs, environment: feature.environment ?? [], effect: effectRules.length ? { name: `Terrain: ${feature.label}`, rules: effectRules } : null, events, summary };
}

// The features' choices for the GM's select, grouped as GM Core lists them.
export const FEATURE_GROUPS = [
    ["Arctic", ["ice", "snow", "snow-deep", "snow-crust"]],
    ["Desert and mountain", ["rubble", "rubble-deep", "sand-shallow", "sand-deep", "slope", "incline", "cliff"]],
    ["Forest, plains and swamp", ["undergrowth-light", "undergrowth-heavy", "undergrowth-thorns", "roots", "trees", "tree-large", "canopy", "hedge", "bog-shallow", "bog-deep", "bog-bottomless", "bog-acid"]],
    ["Underground", ["cave-floor", "ledge", "stalagmites", "stalagmites-sharp"]],
    ["Urban", ["floor-worn", "stairs", "stairs-giant", "street-poor", "crowd", "crowd-packed", "roof-angled", "roof-peak", "roof-steep", "sewer", "sewer-gas"]],
    ["Water", ["water", "current-water"]],
    ["Volcanic and fire", ["lava", "lava-heat", "flames", "ash", "vent-gas", "vent-acid"]]
];

export const simpleDC = (band) => SIMPLE_DCS[band] ?? null;
