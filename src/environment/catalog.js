// GM Core's environment rules (Chapter 2, "Environment", pg. 90–98), as data: the weather and climate a GM switches on for a scene
// (each at a level the GM picks: the user, 2026-10-25), the ground a scene or a region is made of, and the natural disasters a GM sets off.
// Pure: no Foundry. Shared by the environment module (pf2e-automatic-environment-resolution, live play) and the Combat Simulator's fights; the
// rulings where the text leaves numbers to the GM are listed in the environment module's docs/design.md.

// Simple DCs (GM Core's Proficiency DC Band).
export const SIMPLE_DCS = { untrained: 10, trained: 15, expert: 20, master: 30, legendary: 40 };
export const BANDS = ["untrained", "trained", "expert", "master", "legendary"];

// Table 10-11: Environmental Damage — the dice of each category, the GM's pick within it (a default in the middle).
export const DAMAGE_CATEGORIES = {
    minor: { label: "Minor", min: 1, max: 2, dice: 2 },
    moderate: { label: "Moderate", min: 4, max: 6, dice: 5 },
    major: { label: "Major", min: 8, max: 12, dice: 10 },
    massive: { label: "Massive", min: 16, max: 24, dice: 20 }
};

// The GM's dice for a category (clamped to its range), as a formula of d6s; times: that many hits rolled together.
// (The defaults the GM's settings give, scripts/main.js setCategoryDefaults.)
const defaults = {};
export function setCategoryDefaults(dice = {}) {
    for (const [key, value] of Object.entries(dice)) if (DAMAGE_CATEGORIES[key] && Number(value) > 0) defaults[key] = Number(value);
}
export function categoryDice(category, dice = null, { times = 1 } = {}) {
    const entry = DAMAGE_CATEGORIES[category];
    if (!entry) return null;
    const count = Math.min(entry.max, Math.max(entry.min, Math.round(Number(dice) || defaults[category] || entry.dice)));
    return `${count * Math.max(1, Math.round(times))}d6`;
}

// Temperature Effects (pg. 95): each category's fatigue during travel and its damage to the exposed. "every": seconds between hits.
export const MINUTE = 60;
export const HOUR = 3600;
export const TEMPERATURES = [
    { key: "incredible-cold", label: "Incredible cold (−80 °F or colder)", side: "cold", step: 4, fatigueHours: 2, damage: { category: "moderate", type: "cold", every: MINUTE } },
    { key: "extreme-cold", label: "Extreme cold (−79 °F to −20 °F)", side: "cold", step: 3, fatigueHours: 4, damage: { category: "minor", type: "cold", every: 10 * MINUTE } },
    { key: "severe-cold", label: "Severe cold (−21 °F to 12 °F)", side: "cold", step: 2, fatigueHours: 4, damage: { category: "minor", type: "cold", every: HOUR } },
    { key: "mild-cold", label: "Mild cold (13 °F to 32 °F)", side: "cold", step: 1, fatigueHours: 4, damage: null },
    { key: "normal", label: "Normal (33 °F to 94 °F)", side: null, step: 0, fatigueHours: 8, damage: null },
    { key: "mild-heat", label: "Mild heat (95 °F to 104 °F)", side: "heat", step: 1, fatigueHours: 4, damage: null },
    { key: "severe-heat", label: "Severe heat (105 °F to 114 °F)", side: "heat", step: 2, fatigueHours: 4, damage: { category: "minor", type: "fire", every: HOUR } },
    { key: "extreme-heat", label: "Extreme heat (115 °F to 139 °F)", side: "heat", step: 3, fatigueHours: 4, damage: { category: "minor", type: "fire", every: 10 * MINUTE } },
    { key: "incredible-heat", label: "Incredible heat (140 °F or warmer)", side: "heat", step: 4, fatigueHours: 2, damage: { category: "moderate", type: "fire", every: MINUTE } }
];
export const temperatureOf = (key) => TEMPERATURES.find((entry) => entry.key === key) ?? TEMPERATURES.find((entry) => entry.key === "normal");

// A temperature in °F to its category ("* Adjust temperatures down by 15 °F in areas of high humidity": the heat thresholds).
export function temperatureFromFahrenheit(degrees, { humid = false } = {}) {
    const f = Number(degrees);
    if (!Number.isFinite(f)) return "normal";
    if (f <= -80) return "incredible-cold";
    if (f <= -20) return "extreme-cold";
    if (f <= 12) return "severe-cold";
    if (f <= 32) return "mild-cold";
    const shift = humid ? 15 : 0;
    if (f >= 140) return "incredible-heat";
    if (f >= 115) return "extreme-heat";
    if (f >= 105 - shift) return "severe-heat";
    if (f >= 95 - shift) return "mild-heat";
    return "normal";
}

// "Soaked characters treat the temperature as one step colder (mild to severe, severe to extreme)."
export function soakedTemperature(key) {
    return { "mild-cold": "severe-cold", "severe-cold": "extreme-cold" }[key] ?? (key === "normal" ? "normal" : key);
}

// "Appropriate cold-weather gear can negate the damage from severe cold or reduce the damage from extreme cold to that of particularly
// severe cold." (Heat: the same for protection from heat — Environmental Endurance's own words cover both, docs/design.md.)
export function protectedTemperature(key, { gear = false, endurance = false } = {}) {
    if (endurance && ["severe-cold", "extreme-cold", "severe-heat", "extreme-heat"].includes(key)) return key.endsWith("cold") ? "mild-cold" : "mild-heat";
    if (gear && key === "severe-cold") return "mild-cold";
    if (gear && key === "extreme-cold") return "severe-cold";
    return key;
}

// --- Weather (Climate, pg. 94–95): toggles, each at a level the GM picks -------------------------------------------------------
// A level's numbers: penalty (the circumstance penalty, 0 to −4), beyond (creatures farther than this many feet are concealed; 0 = every
// creature is; null = none), hidden (beyond that, hidden instead: underwater visibility). The GM can change "beyond" and the DCs.
const FOG_LEVELS = [
    { key: "mist", label: "Mist or haze", penalty: 0, beyond: null, note: "Visibility about a mile (mist) or 3 miles (haze): no effect within a fight." },
    { key: "light", label: "Light fog", penalty: -1, beyond: 60 },
    { key: "moderate", label: "Fog", penalty: -2, beyond: 30 },
    { key: "thick", label: "Thick fog", penalty: -3, beyond: 10 },
    { key: "severe", label: "Pea-soup fog", penalty: -4, beyond: 0 }
];
const SMOKE_LEVELS = [
    { key: "light", label: "Light smoke", penalty: -1, beyond: 60 },
    { key: "moderate", label: "Smoke", penalty: -2, beyond: 30 },
    { key: "thick", label: "Thick smoke", penalty: -3, beyond: 10 },
    { key: "severe", label: "Choking smoke", penalty: -4, beyond: 0 }
];

export const WEATHER = {
    fog: { label: "Fog", sense: "sight", levels: FOG_LEVELS, text: "Fog imposes a penalty to visual Perception checks, and creatures seen through enough of it are concealed." },
    precipitation: {
        label: "Precipitation",
        sense: "sight",
        kinds: {
            rain: { label: "Rain", wet: true },
            sleet: { label: "Sleet", wet: true, frozen: true },
            snow: { label: "Snow", frozen: true, snow: true },
            hail: { label: "Hail", frozen: true, sense: "hearing", conceals: false }
        },
        levels: [
            // (Labels that read with the kind: "Heavy rain", "Very heavy snow"; a downpour is very heavy rain, a whiteout torrential snow.)
            { key: "light", label: "Light", penalty: 0, beyond: null, note: "Drizzle or light snowfall: little effect beyond limited visibility." },
            { key: "moderate", label: "Steady", penalty: -1, beyond: null },
            { key: "heavy", label: "Heavy", penalty: -2, beyond: 120, soaks: true },
            { key: "downpour", label: "Very heavy", penalty: -3, beyond: 60, soaks: true },
            { key: "deluge", label: "Torrential", penalty: -4, beyond: 30, soaks: true }
        ],
        text: "Wet precipitation douses flames; frozen precipitation can leave snow or ice on the ground. Hail penalizes auditory Perception instead of visual."
    },
    wind: {
        label: "Wind",
        sense: "hearing",
        levels: [
            { key: "light", label: "Light wind", penalty: 0, note: "No effect in a fight." },
            { key: "moderate", label: "Moderate wind", penalty: -1, ranged: -1 },
            { key: "strong", label: "Strong wind", penalty: -2, ranged: -2, flying: 2, snuffs: "handheld" },
            { key: "severe", label: "Severe wind (gale)", penalty: -3, ranged: -3, flying: 3, snuffs: "handheld", flightDC: 20, blownFeet: 20, groundDC: 15, groundSizes: ["sm", "tiny"] },
            { key: "windstorm", label: "Windstorm", penalty: -4, ranged: null, flying: 3, snuffs: "lanterns", flightDC: 30, blownFeet: 40, groundDC: 20, groundSizes: null }
        ],
        text: "Wind penalizes auditory Perception and physical ranged attacks (impossible in a windstorm), hinders fliers and snuffs flames."
    },
    thunderstorm: {
        label: "Thunderstorm",
        levels: [
            { key: "storm", label: "Thunderstorm", lightning: "moderate", wind: "strong", precipitation: "heavy" },
            { key: "severe", label: "Severe thunderstorm", lightning: "major", wind: "severe", precipitation: "downpour" }
        ],
        // "a very small chance that a character might be struck by lightning": one in this many, for each exposed creature, each minute.
        chance: 200,
        lightningDC: null,
        text: "High winds and heavy rain; a very small chance each minute that a creature is struck by lightning."
    },
    smoke: { label: "Smoke", sense: "sight", levels: SMOKE_LEVELS, text: "Smoke works like fog. Near or within a wildfire, smoke and heated air must be held off by holding your breath." },
    ash: {
        label: "Volcanic ash",
        sense: "sight",
        levels: SMOKE_LEVELS.map((level, index) => ({ ...level, label: ["Light ash", "Ash", "Thick ash", "Choking ash"][index] })),
        damage: { category: "minor", type: "fire", every: MINUTE },
        // Ash lightning: "very unlikely to hit an individual creature".
        chance: 1000,
        lightning: "moderate",
        lightningDC: null,
        text: "Hot ash deals minor fire damage each minute, limits visibility like a thick fog and can make the air unbreathable."
    },
    sandstorm: {
        label: "Sandstorm",
        sense: "sight",
        levels: [
            { key: "mild", label: "Mild sandstorm or dust storm", penalty: -1, hearing: -1, beyond: 60 },
            { key: "heavy", label: "Heavy sandstorm", penalty: -2, hearing: -2, beyond: 30, damage: { category: "minor", type: "slashing", every: "round" } }
        ],
        text: "Heavy sandstorms deal minor slashing damage each round to the exposed, force them to hold their breath, or both."
    },
    underwater: {
        label: "Underwater",
        levels: [
            { key: "clear", label: "Clear water", hiddenBeyond: 240 },
            { key: "murky", label: "Murky water", hiddenBeyond: 10 }
        ],
        text: "Aquatic combat: off-guard without a swim Speed, −2 to bludgeoning and slashing melee attacks, ranged bludgeoning and slashing attacks miss, piercing range increments halved, no fire, resistance 5 to acid and fire; air runs out."
    },
    current: {
        label: "Current",
        levels: [
            { key: "slow", label: "Slow current", feet: 10, swim: 2 },
            { key: "fast", label: "Fast current", feet: 20, swim: 2 },
            { key: "rapid", label: "Rapid current", feet: 30, swim: 3 }
        ],
        text: "At the end of each creature's turn in it, the current moves it its speed in the current's direction; swimming against it is difficult or greater difficult terrain."
    }
};

export const DIRECTIONS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };

export const levelOf = (toggle, key) => (WEATHER[toggle]?.levels ?? []).find((level) => level.key === key) ?? null;

// --- Ground: the environmental features a scene or a region is made of (pg. 91–94) ----------------------------------------------
// cost: 2 difficult, 3 greater difficult, for the movement actions listed (walk by default); upCost: that only moving up it (stairs); uneven /
// narrow: Balance for each move on it; cover: "standard" automatically, "take" lets a creature Take Cover; hazard: damage for each move into
// or through it ("enter") or at the start of each turn inside ("turn"); swim: must Swim; climb: an incline; band: the Proficiency DC Band of
// its checks; environment: PF2e's environment types it adds.
export const FEATURES = {
    ice: { label: "Ice", cost: 2, uneven: true, band: ["trained", "master"], environment: ["arctic"] },
    "snow": { label: "Snow", cost: 2, band: ["untrained", "expert"], environment: ["arctic"] },
    "snow-deep": { label: "Deep snow", cost: 3, band: ["untrained", "expert"], environment: ["arctic"] },
    "snow-crust": { label: "Snow crust (loose patches)", uneven: true, band: ["untrained", "expert"], environment: ["arctic"] },
    rubble: { label: "Rubble", cost: 2, band: ["untrained", "expert"] },
    "rubble-deep": { label: "Deep rubble or scree", cost: 2, uneven: true, band: ["untrained", "expert"] },
    "sand-shallow": { label: "Loose sand (shallow)", cost: 2, band: ["untrained", "expert"], environment: ["desert"] },
    "sand-deep": { label: "Loose sand (deep) or dune face", uneven: true, band: ["untrained", "expert"], environment: ["desert"] },
    "undergrowth-light": { label: "Light undergrowth", cost: 2, cover: "take", band: ["untrained", "expert"] },
    "undergrowth-heavy": { label: "Heavy undergrowth", cost: 3, cover: "standard", band: ["untrained", "expert"] },
    "undergrowth-thorns": { label: "Thorny undergrowth", cost: 2, cover: "take", hazard: { category: "minor", type: "piercing", when: "enter" }, band: ["untrained", "expert"] },
    roots: { label: "Twisting roots", cost: 2, uneven: true, band: ["untrained", "expert"] },
    "bog-shallow": { label: "Shallow bog", cost: 2, band: ["untrained", "trained"], environment: ["swamp"] },
    "bog-deep": { label: "Deep bog", cost: 3, band: ["untrained", "trained"], environment: ["swamp"] },
    "bog-bottomless": { label: "Bog too deep to stand in", swim: true, band: ["untrained", "trained"], environment: ["swamp"] },
    "bog-acid": { label: "Acidic bog", cost: 3, hazard: { category: "minor", type: "acid", when: "turn" }, band: ["untrained", "trained"], environment: ["swamp"] },
    hedge: { label: "Hedge", cost: 3, cover: "standard", climb: true, band: ["untrained", "trained"], environment: ["plains"] },
    "tree-large": { label: "Large tree (cover)", cover: "standard", climb: true, band: ["untrained", "master"], environment: ["forest"] },
    trees: { label: "Trees (Take Cover)", cover: "take", band: ["untrained", "master"], environment: ["forest"] },
    canopy: { label: "Canopy", climb: true, cover: "standard", band: ["trained", "master"], environment: ["forest"] },
    cliff: { label: "Cliff or rock wall", climb: true, band: ["trained", "master"], environment: ["mountain"] },
    slope: { label: "Slope", cost: 2, band: ["untrained", "trained"], environment: ["mountain"] },
    incline: { label: "Steep slope (incline)", climb: true, band: ["untrained", "trained"], environment: ["mountain"] },
    ledge: { label: "Ledge (narrow)", narrow: true, band: ["untrained", "master"], environment: ["underground"] },
    stalagmites: { label: "Stalagmites", cost: 3, band: ["trained", "expert"], environment: ["underground"] },
    "stalagmites-sharp": { label: "Sharp stalagmites", cost: 3, hazard: { category: "minor", type: "piercing", when: "enter" }, band: ["trained", "expert"], environment: ["underground"] },
    "cave-floor": { label: "Uneven cave floor", cost: 2, uneven: true, band: ["untrained", "expert"], environment: ["underground"] },
    "floor-worn": { label: "Worn flagstones", uneven: true, band: ["untrained", "expert"], environment: ["urban"] },
    // (Difficult only going up — "Stairs are difficult terrain for characters moving up them": the region's up direction, the GM's.)
    stairs: { label: "Stairs", upCost: 2, band: ["untrained", "trained"], environment: ["urban"], note: "Shoddy stairs are uneven ground too." },
    "stairs-giant": { label: "Enormous stairs", cost: 3, band: ["untrained", "trained"], environment: ["urban"] },
    "street-poor": { label: "Broken cobblestones", cost: 2, uneven: true, band: ["untrained", "trained"], environment: ["urban"] },
    crowd: { label: "Crowd", cost: 2, band: ["trained", "master"], environment: ["urban"], part: true },
    "crowd-packed": { label: "Packed crowd", cost: 3, band: ["trained", "master"], environment: ["urban"], part: true },
    "roof-angled": { label: "Angled roof", uneven: true, band: ["trained", "master"], environment: ["urban"] },
    "roof-peak": { label: "Roof peak (narrow)", narrow: true, band: ["trained", "master"], environment: ["urban"] },
    "roof-steep": { label: "Steep roof (incline)", climb: true, band: ["trained", "master"], environment: ["urban"] },
    sewer: { label: "Sewer waste", cost: 2, band: ["untrained", "trained"], environment: ["urban"], note: "Disease-ridden waste: the GM's disease, if any." },
    "sewer-gas": { label: "Sewer gas", band: ["untrained", "trained"], environment: ["urban"], explodes: { category: "moderate", type: "fire" }, note: "A pocket of sewer gas exposed to flame explodes: moderate fire damage to creatures in the area." },
    "current-water": { label: "Flowing water", swim: true, current: true, band: ["trained", "master"], environment: ["aquatic"] },
    water: { label: "Deep water", swim: true, band: ["trained", "master"], environment: ["aquatic"] },
    lava: { label: "Lava", hazard: { category: "massive", type: "fire", when: "turn" }, band: ["expert", "legendary"] },
    "lava-heat": { label: "Near lava (heat)", reachesAir: true, hazard: { category: "minor", type: "fire", when: "turn" }, band: ["expert", "legendary"], note: "Lava emanates heat that deals minor fire damage even before it comes into contact with creatures." },
    flames: { label: "Wildfire flames", reachesAir: true, hazard: { category: "moderate", type: "fire", when: "enter", persistent: { category: "moderate", type: "fire" } }, band: ["expert", "legendary"] },
    "vent-gas": { label: "Toxic vent gas", reachesAir: true, hazard: { category: "minor", type: "poison", when: "turn" }, band: ["trained", "legendary"] },
    "vent-acid": { label: "Acidic vent gas", reachesAir: true, hazard: { category: "minor", type: "acid", when: "turn" }, band: ["trained", "legendary"] },
    ash: { label: "Deep ash", cost: 2, uneven: true, band: ["trained", "legendary"] }
};

// --- Natural disasters (pg. 96–98): what a GM's button posts --------------------------------------------------------------------
// save: the save, degrees: what each degree does (half/full damage, buried, prone, carried, picked-up), category: the GM's default.
export const DISASTERS = {
    avalanche: { label: "Avalanche, landslide or mudslide", save: "reflex", category: "major", categories: ["major", "massive"], type: "bludgeoning", band: ["expert", "legendary"],
        degrees: { criticalSuccess: { damage: "half" }, success: { damage: "half", buried: true }, failure: { damage: "full", buried: true }, criticalFailure: { damage: "full", buried: true } } },
    collapse: { label: "Collapse or cave-in", save: "reflex", category: "major", categories: ["major", "massive"], type: "bludgeoning", band: ["expert", "legendary"],
        degrees: { criticalSuccess: { damage: "half" }, success: { damage: "half", buried: true }, failure: { damage: "full", buried: true }, criticalFailure: { damage: "full", buried: true } } },
    tremor: { label: "Earthquake: tremor", save: "reflex", category: "minor", categories: ["minor", "moderate", "major"], type: "bludgeoning", band: ["trained", "legendary"],
        degrees: { criticalSuccess: {}, success: {}, failure: { damage: "full", prone: true }, criticalFailure: { damage: "double", prone: true } } },
    fissure: { label: "Earthquake: fissure", save: "reflex", falling: 20, band: ["trained", "legendary"],
        degrees: { criticalSuccess: {}, success: {}, failure: { falls: true }, criticalFailure: { falls: true } } },
    liquefaction: { label: "Earthquake: soil liquefaction", save: "reflex", band: ["trained", "legendary"],
        degrees: { criticalSuccess: {}, success: {}, failure: { restrained: true }, criticalFailure: { restrained: true, sinking: true } } },
    flood: { label: "Flash flood", save: "reflex", category: "major", categories: ["moderate", "major", "massive"], type: "bludgeoning", band: ["expert", "legendary"], carry: 60,
        degrees: { criticalSuccess: { damage: "half" }, success: { damage: "half", carried: true }, failure: { damage: "full", carried: true }, criticalFailure: { damage: "full", carried: true } } },
    tsunami: { label: "Tsunami", save: "reflex", category: "massive", categories: ["massive"], type: "bludgeoning", band: ["master", "legendary"], carry: 120,
        degrees: { criticalSuccess: { damage: "half", carried: true }, success: { damage: "half", carried: true }, failure: { damage: "full", carried: true }, criticalFailure: { damage: "full", carried: true } } },
    // (Its wind: an Athletics check against it — a creature "that would normally be blown away", the critical failure, is picked up.)
    tornado: { label: "Tornado", save: "athletics", category: "massive", categories: ["massive"], type: "bludgeoning", band: ["master", "legendary"], falling: 60,
        degrees: { criticalSuccess: {}, success: {}, failure: { pushed: 10, prone: true }, criticalFailure: { damage: "full", pickedUp: true } } },
    "lava-bomb": { label: "Lava bomb", save: "reflex", basic: true, category: "moderate", categories: ["moderate", "major"], type: "bludgeoning", also: "fire", band: ["trained", "legendary"] },
    pyroclastic: { label: "Pyroclastic flow", save: "reflex", category: "major", categories: ["major", "massive"], type: "bludgeoning", halfFire: true, band: ["expert", "legendary"],
        degrees: { criticalSuccess: { damage: "half" }, success: { damage: "half", buried: true }, failure: { damage: "full", buried: true }, criticalFailure: { damage: "full", buried: true } } },
    "steam-vent": { label: "Steam vent", save: "reflex", basic: true, category: "moderate", categories: ["moderate", "major"], type: "fire", band: ["trained", "legendary"] },
    // (Heat and lightning name no save: their damage lands — the GM can give a basic save on the card.)
    "wildfire-heat": { label: "Wildfire heat", save: null, optionalSave: "fortitude", category: "minor", categories: ["minor", "moderate", "major", "massive"], type: "fire", band: ["expert", "legendary"] },
    "wildfire-flames": { label: "Wildfire flames", save: "reflex", basic: true, category: "moderate", categories: ["moderate"], type: "fire", persistent: { category: "moderate", type: "fire" }, band: ["expert", "legendary"] },
    lightning: { label: "Lightning strike", save: null, optionalSave: "reflex", category: "moderate", categories: ["moderate", "major"], type: "electricity", band: ["trained", "legendary"] },
    "sewer-gas": { label: "Sewer gas explosion", save: "reflex", basic: true, category: "moderate", categories: ["moderate"], type: "fire", band: ["untrained", "trained"] }
};

// Buried (pg. 96): restrained; minor bludgeoning each minute (and minor cold under snow); dug out by others, a 5-foot square every
// 4 minutes for each successful Athletics check (2 for a critical one), halved with tools.
export const BURIAL = { damage: { category: "minor", type: "bludgeoning", every: MINUTE }, snow: { category: "minor", type: "cold", every: MINUTE }, digMinutes: { success: 4, criticalSuccess: 2 } };

// Doors, Gates and Walls (pg. 93): Climb DC, Hardness, HP (BT); Forcing Open DCs.
export const STRUCTURES = {
    "door-wood": { label: "Wooden door", climb: 20, hardness: 10, hp: 40, bt: 20 },
    "door-stone": { label: "Stone door", climb: 30, hardness: 14, hp: 56, bt: 28 },
    "door-reinforced": { label: "Reinforced wooden door", climb: 15, hardness: 15, hp: 60, bt: 30 },
    "door-iron": { label: "Iron door", climb: 30, hardness: 18, hp: 72, bt: 36 },
    "wall-crumbling": { label: "Crumbling masonry wall", climb: 15, hardness: 10, hp: 40, bt: 20 },
    "wall-slats": { label: "Wooden slat wall", climb: 15, hardness: 10, hp: 40, bt: 20 },
    "wall-masonry": { label: "Masonry wall", climb: 20, hardness: 14, hp: 56, bt: 28 },
    "wall-hewn": { label: "Hewn stone wall", climb: 30, hardness: 14, hp: 56, bt: 28, downtime: true },
    "wall-iron": { label: "Iron wall", climb: 40, hardness: 18, hp: 72, bt: 36, downtime: true },
    "portcullis-wood": { label: "Wooden portcullis", climb: 10, hardness: 10, hp: 40, bt: 20, force: 20 },
    "portcullis-iron": { label: "Iron portcullis", climb: 10, hardness: 18, hp: 72, bt: 36, force: 30 }
};
export const FORCE_OPEN = { stuck: { label: "Stuck door or window", dc: 15 }, "very-stuck": { label: "Exceptionally stuck", dc: 20 }, "portcullis-wood": { label: "Lift wooden portcullis", dc: 20 }, "portcullis-iron": { label: "Lift iron portcullis", dc: 30 }, bars: { label: "Bend metal bars", dc: 30 } };

// Holding your breath (Player Core 437): 5 + Con rounds of air; 1 a turn (2 after attacking or casting), 1 more for a critical hit taken or a
// critical failure against a damaging effect, all of it for speaking. Out of air: unconscious, a DC 20 Fortitude save at the end of each
// turn, 1d10 damage on a failure, death on a critical failure, +5 DC and +1d10 damage each save after the first.
export const BREATH = { base: 5, suffocateDC: 20, dcStep: 5, die: 10 };
