// The "save" family: saves (basic or not) and spell attacks, as a pure
// resolver (docs/plan-model.md section 7, step 3.1). The spell compiler's
// plans of kind "save" are the input; the output is Change ops and typed
// decisions, with what this family doesn't model yet listed as gaps.
//
// context: {
//   caster, targets: [actor…], castRank?,
//   id(actor)?          → a stable id for a change's target (default actor.id ?? actor.uuid)
//   statistic(actor, slug) → { modifier, dc }  slugs: "fortitude", "reflex", "will", "ac", "spell" (the spell attack and DC), "strike"
//   traits(actor)?      → [trait…] (degree adjustments by trait)
//   iwr(actor)?         → { immunities } (Flame Strike's fire-immune creatures)
//   allied(a, b)?       → boolean (otherwise the GM is asked)
// }
// io: { roll(statistic, { actor, modifier, dc }) → { degree }, damage?(instance) → number, choose?(decision) → value }

import { DEGREES, SAVES } from "../model/constants.js";
import { makeDecision } from "../model/decisions.js";
import { drive, driveSync } from "../drive.js";
import { healingOf, healsTarget, planWithActions, sharedDamageOf } from "./shared.js";
import { readPlan } from "../model/plan.js";
import { addSteps, parseDamage, parseDamagePools } from "../model/dice.js";

export const SAVE_KIND = "save";

// Resolution payload keys and outcome keys this family resolves, and the ones
// that are only text for the GM (a note, never a gap).
// Note effects, PF2e spell effects and manual instructions become changes the
// GM or PF2e carries out (effect kinds "note" and "native", manual notes); the
// Combat Simulator decides what of those it can model.
const RESOLVED_PAYLOAD = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "casterChoice", "degreeAdjustment", "attackAdjustment", "heightenedVariants", "afflictionHandoff", "native", "conditionalDamage"]);
const NOTE_PAYLOAD = new Set(["reminders", "dataNotes", "temporaryImmunity"]);
const RESOLVED_OUTCOME = new Set(["damage", "effects", "forcedMovement", "modifiers", "noteEffects", "nativeEffects", "manualInstructions", "followUps", "terminal", "affliction", "conditionFloor"]);
// (replacedLinks: the links live compiling replaced in the row's text — Calm's Spell Effect: Calm.)
// (noRecurringSave: Confusion's critical failure, "with no save to end early" — a row's conditions have none unless they say so.)
const TEXT_OUTCOME = new Set(["rawText", "semanticCoverage", "rowImmunityText", "inheritedDurationText", "rowNotes", "decisions", "replacedLinks", "noRecurringSave"]);
const CASTER_CHOICES = new Set(["damage-type", "option"]);

const isEmpty = (value) => value === null || value === undefined || value === false || (Array.isArray(value) && !value.length) || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);

// What a plan asks of this family that it doesn't resolve yet:
// [{ path, what }]. Empty when every mechanical part is covered.
// Effects the family passes on as { op: "effect" } changes, with their own fields.
const PASSED_EFFECTS = new Set(["disarm", "swallow"]);

function passedEffect(effect) {
    if (effect.kind === "disarm") return { kind: "disarm", what: effect.what, penalty: effect.penalty ?? 0 };
    const { recipient, ...rest } = effect;
    return rest;
}

export function saveGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = [];
    for (const [key, value] of Object.entries(resolution)) {
        if (RESOLVED_PAYLOAD.has(key) || NOTE_PAYLOAD.has(key) || isEmpty(value)) continue;
        gaps.push({ path: `resolution.${key}`, what: key });
    }
    if (resolution.postDamageTerminal && resolution.postDamageTerminal.kind !== "death") gaps.push({ path: "resolution.postDamageTerminal", what: "postDamageTerminal" });
    // Live play's own healing payload, with no native numbers beside it.
    if (resolution.healing && !healingOf(plan)) gaps.push({ path: "resolution.healing", what: "healing" });
    if (resolution.casterChoice && !CASTER_CHOICES.has(resolution.casterChoice.kind)) gaps.push({ path: "resolution.casterChoice", what: `casterChoice:${resolution.casterChoice.kind}` });
    const check = resolution.check;
    const skillCheck = (check?.roll === "skill" || check?.roll === "perception") && check.statistic && check.against?.statistic;
    // (2026-10-15, asked by the item module: "automatic" — no roll, the success row — is resolved by saveSteps; before, it was reported as a gap.)
    // (2026-10-16, the item module's Mercurial Mantle: "the target attempts a @Check[perception|dc:38] check" — the target's Perception against a
    // fixed DC, rolled as a save is.)
    const perceptionSave = check?.roll === "save" && check.statistic === "perception" && check.against?.dc === "fixed";
    if (!check || !(SAVES.includes(check.statistic) || check.statistic === "spell-attack" || check.statistic === "strike" || skillCheck || perceptionSave || check.roll === "automatic")) gaps.push({ path: "resolution.check", what: "check" });
    for (const degree of DEGREES) {
        const outcome = resolution.outcomes?.[degree];
        if (!outcome) continue;
        for (const [key, value] of Object.entries(outcome)) {
            if (isEmpty(value) || RESOLVED_OUTCOME.has(key) || TEXT_OUTCOME.has(key)) continue;
            gaps.push({ path: `resolution.outcomes.${degree}.${key}`, what: key });
        }
        for (const [index, effect] of (outcome.effects ?? []).entries()) {
            if (effect?.kind !== "condition" && effect?.kind !== "end-condition" && effect?.kind !== "temp-hp" && effect?.kind !== "heal" && !PASSED_EFFECTS.has(effect?.kind)) gaps.push({ path: `resolution.outcomes.${degree}.effects.${index}`, what: `effect:${effect?.kind}` });
        }
        for (const [index, entry] of (outcome.noteEffects ?? []).entries()) {
            if (entry?.choiceGroup && !(entry.choiceGroup === "caster-option" && resolution.casterChoice?.kind === "option")) gaps.push({ path: `resolution.outcomes.${degree}.noteEffects.${index}`, what: `choiceGroup:${entry.choiceGroup}` });
        }
        for (const [index, entry] of (outcome.followUps ?? []).entries()) {
            if (entry?.kind !== "save") gaps.push({ path: `resolution.outcomes.${degree}.followUps.${index}`, what: `followUp:${entry?.kind}` });
        }
        if (outcome.terminal && outcome.terminal.kind !== "death") gaps.push({ path: `resolution.outcomes.${degree}.terminal`, what: `terminal:${outcome.terminal.kind}` });
        if (outcome.affliction && !resolution.afflictionHandoff) gaps.push({ path: `resolution.outcomes.${degree}.affliction`, what: "affliction without a handoff" });
    }
    return gaps;
}

export function validateSave(resolution) {
    const issues = [];
    if (!resolution?.check?.statistic) issues.push("A save resolution names the statistic it rolls.");
    if (!resolution?.outcomes || !DEGREES.some((degree) => resolution.outcomes[degree])) issues.push("A save resolution has outcomes by degree.");
    return issues;
}

// The plan at the cast rank: a heightened entry's outcomes replace the base ones.
export function heightenedAt(plan, castRank) {
    const variant = (plan?.resolution?.heightenedVariants ?? []).filter((entry) => Number(castRank) >= entry.minRank).at(-1);
    return variant ? { ...plan, resolution: { ...plan.resolution, outcomes: variant.outcomes } } : plan;
}

// The shared damage components at the cast rank: [{ id, instances }].
// Interval heightening adds its dice per step; fixed heightening replaces a
// component's formula from the highest listed rank reached.
// componentTypes: { [componentId]: type } from native.damageTypeChoices.
export function sharedComponentsAt(sharedDamage, baseRank, castRank, { typeOverride = null, componentTypes = null } = {}) {
    if (!sharedDamage?.components?.length) return [];
    const retype = (instances) => (typeOverride ? instances.map((instance) => (typeOverride.from.includes(instance.type) || instance.type === "untyped" ? { ...instance, type: typeOverride.to } : instance)) : instances);
    // (A component's own materials — PF2e's damage partial's — on its instances, beside those its formula's flavor names.)
    const materialsOf = (component, instances) => ((component.materials ?? []).length ? instances.map((instance) => ({ ...instance, materials: [...new Set([...(instance.materials ?? []), ...component.materials])] })) : instances);
    const chosen = (component, instances) => materialsOf(component, componentTypes?.[component.id] ? instances.map((instance) => ({ ...instance, type: componentTypes[component.id] })) : instances);
    // Damage read from the text (mode "formula"): its formula carries the rank
    // scaling, one pool per component (as the spell module's text damage reads it).
    if (sharedDamage.mode === "formula" && sharedDamage.formula) {
        const pools = parseDamagePools(sharedDamage.formula, { rank: castRank });
        if (pools.length === sharedDamage.components.length) {
            return sharedDamage.components.map((component, index) => ({ id: component.id, instances: chosen(component, retype(pools[index])) }));
        }
    }
    const heightening = sharedDamage.heightening ?? null;
    const steps = heightening?.type === "interval" && heightening.interval > 0 ? Math.max(0, Math.floor((castRank - baseRank) / heightening.interval)) : 0;
    const fixedRank = heightening?.type === "fixed"
        ? Object.keys(heightening.levels ?? {}).map(Number).filter((rank) => rank <= castRank).sort((a, b) => a - b).at(-1)
        : undefined;
    return sharedDamage.components.map((component) => {
        const fixed = fixedRank !== undefined ? heightening.levels[fixedRank]?.damage?.[component.id] : null;
        const formula = fixed?.formula ?? component.formula;
        const defaults = { rank: castRank, type: fixed?.type ?? component.type, category: fixed?.category ?? component.category ?? null };
        let instances = parseDamage(formula, defaults);
        const increase = steps && heightening.damage?.[component.id];
        if (increase) instances = addSteps(instances, parseDamage(increase, defaults), steps);
        return { id: component.id, instances: chosen(component, retype(instances)) };
    });
}

// An outcome formula at the cast rank (its own interval heightening, from the spell's base rank).
function outcomeFormulaAt(entry, baseRank, castRank) {
    let instances = parseDamage(entry.formula, { rank: castRank });
    const heightening = entry.heightening;
    if (heightening?.type === "interval" && heightening.interval > 0 && heightening.formula) {
        const steps = Math.max(0, Math.floor((castRank - baseRank) / heightening.interval));
        instances = addSteps(instances, parseDamage(heightening.formula, { rank: castRank }), steps);
    }
    return instances;
}

const idOf = (context, actor, index) => context.id?.(actor) ?? actor?.id ?? actor?.uuid ?? `target-${index}`;

function statisticOf(context, actor, slug) {
    const value = context.statistic?.(actor, slug);
    if (!value) throw new Error(`The context has no ${slug} statistic for ${actor?.name ?? "a creature"}.`);
    return value;
}

// multiplier: a basic save's half or double on the rolled amount (absent when the dice stand as rolled, so a
// runtime can keep the dice for the persistent damage's later rounds).
function persistentChange(target, instance, amount, multiplier = 1) {
    return {
        op: "condition",
        target,
        slug: "persistent-damage",
        value: null,
        damage: { type: instance.type, dice: instance.dice, constant: instance.constant, amount, ...(multiplier !== 1 ? { multiplier } : {}), ...(instance.materials?.length ? { materials: instance.materials } : {}) }
    };
}

// Damage changes for one target: immediate instances in one damage change,
// persistent ones as persistent-damage conditions.
function damageChanges(target, rolled) {
    const changes = [];
    const immediate = [];
    for (const { instance, amount, multiplier } of rolled) {
        if (instance.category === "persistent") changes.push(persistentChange(target, instance, amount, multiplier));
        else if (amount > 0) immediate.push({ type: instance.type, category: instance.category, amount, ...(instance.materials?.length ? { materials: instance.materials } : {}) });
    }
    if (immediate.length) changes.unshift({ op: "damage", target, instances: immediate });
    return changes;
}

// The resolution as steps: it yields requests ({ type: "roll" | "damage" |
// "choose" }) and is sent the answers, so one body serves live play (async,
// through PF2e) and the Combat Simulator (sync, thousands of fights). See
// src/drive.js.
export function* saveSteps(plan, context = {}) {
    plan = readPlan(plan);
    const baseRank = Number(plan.rank ?? 1) || 1;
    const castRank = Number(context.castRank ?? baseRank) || baseRank;
    plan = heightenedAt(planWithActions(plan, context.actions), castRank);
    const resolution = plan.resolution;
    const check = resolution.check;
    const targets = context.targets ?? [];
    const decisions = [];
    function* ask(decision) {
        const made = makeDecision(decision);
        decisions.push(made);
        return yield { type: "choose", decision: made };
    }
    function* rollEach(instances) {
        const rolled = [];
        for (const instance of instances) rolled.push({ instance, amount: yield { type: "damage", instance } });
        return rolled;
    }

    // Pre-cast: the caster picks a damage type (Murmuration).
    let typeOverride = null;
    const choice = resolution.casterChoice;
    if (choice?.kind === "damage-type" && choice.values?.length) {
        const to = yield* ask({ id: "caster-choice:damage-type", phase: "pre-cast", question: choice.label ?? "Damage type", options: choice.values.map((value) => ({ value, label: value })), default: choice.values[0], audience: "owner" });
        typeOverride = { from: choice.values, to };
    }
    // Pre-cast: the caster picks an option (Invoke the Harrow's suit); only that option's note effects apply.
    let option = null;
    if (choice?.kind === "option" && choice.values?.length) {
        option = yield* ask({ id: "caster-choice:option", phase: "pre-cast", question: choice.label ?? "Option", options: choice.values.map((value) => ({ value, label: choice.labels?.[value] ?? value })), default: choice.values[0], audience: "owner" });
    }

    // Pre-cast: a damage type for each component PF2e lets the caster choose (Telekinetic Projectile).
    const componentTypes = {};
    for (const [id, types] of Object.entries(plan.resolution.native?.damageTypeChoices ?? {})) {
        if (!Array.isArray(types) || !types.length) continue;
        componentTypes[id] = yield* ask({ id: `damage-type:${id}`, phase: "pre-cast", question: "Damage type", options: types.map((type) => ({ value: type, label: type })), default: types[0], audience: "owner" });
    }

    // Shared damage, rolled once for every target when the plan says so.
    const sharedDamage = sharedDamageOf(plan);
    const components = sharedComponentsAt(sharedDamage, baseRank, castRank, { typeOverride, componentTypes });
    const rollOnce = sharedDamage?.rollOnce !== false;
    function* sharedRoll() {
        const amounts = new Map();
        for (const component of components) amounts.set(component.id, yield* rollEach(component.instances));
        return amounts;
    }
    const sharedOnce = rollOnce ? yield* sharedRoll() : null;
    const outcomeRolls = new Map();

    // Heal and Harm: their recipients are healed (rolled once) and don't save.
    const nativeHealing = healingOf(plan);
    const healing = nativeHealing ? sharedComponentsAt(nativeHealing, baseRank, castRank) : [];
    let healAmount = null;
    if (healing.length) healAmount = (yield* rollEach(healing.flatMap((component) => component.instances))).reduce((sum, { amount }) => sum + amount, 0);

    const degrees = {};
    const rolls = {};
    const changes = [];
    const caster = context.caster ?? null;
    const attack = check.roll === "attack";

    for (const [index, actor] of targets.entries()) {
        const target = idOf(context, actor, index);
        if (healAmount !== null && healsTarget(nativeHealing.recipients ?? "any", actor, context)) {
            changes.push({ op: "heal", target, amount: healAmount });
            continue;
        }
        // Pre-roll: a GM question that sets a modifier (Chroma Leach, Phase Bolt).
        let adjustment = 0;
        const preRoll = resolution.attackAdjustment;
        if (preRoll?.choices?.length) {
            adjustment = Number(yield* ask({ id: `attack-adjustment:${target}`, phase: "pre-roll", question: preRoll.question, options: preRoll.choices.map((option) => ({ value: option.value, label: option.label })), default: preRoll.choices.find((option) => Number(option.value) === 0)?.value ?? preRoll.choices[0].value })) || 0;
        }

        let roll;
        if (attack) {
            const attacker = statisticOf(context, caster, check.statistic === "strike" ? "strike" : "spell");
            const defence = statisticOf(context, actor, "ac");
            const penalty = check.sharedMultipleAttackPenalty ? -5 * Math.min(index, 2) : 0;
            // Phase Bolt's answer is the AC bonus it removes: a bonus to the attack.
            roll = yield { type: "roll", statistic: check.statistic, options: { actor: caster, target: actor, modifier: attacker.modifier + penalty + adjustment, dc: defence.dc } };
        } else if (check.roll === "automatic") {
            // No roll at all ("The target takes 3d8 fire damage", 2026-10-10): every target's result is the success row.
            roll = { degree: "success", total: null, natural: null };
        } else if (check.roll === "skill" || check.roll === "perception") {
            // The actor's skill against the target's DC (Trip: Athletics against Reflex DC).
            // A list of statistics (Escape): the actor's best.
            const options = [].concat(check.statistic);
            // A fixed modifier of its own (PF2e's special attack statistics, "@Check[efficient-capture|against:ac]{+16}", batch 121):
            // that, with the context's adjustment for the actor (its penalties, the multiple attack penalty), asked as "fixed-check".
            const fixed = Number.isFinite(check.modifier) ? check.modifier : null;
            const slug = fixed !== null ? options[0] : options.reduce((best, slug) => ((statisticOf(context, caster, slug).modifier ?? 0) > (statisticOf(context, caster, best).modifier ?? 0) ? slug : best));
            const skill = fixed !== null ? { modifier: fixed + (context.statistic?.(caster, "fixed-check")?.modifier ?? 0) } : statisticOf(context, caster, slug);
            const defence = statisticOf(context, actor, check.against?.statistic ?? "will");
            const dc = check.against?.dc === "fixed" ? check.against.value : defence.dc ?? 10 + (defence.modifier ?? 0);
            // A bonus of its own ("They gain a +4 status bonus to the Athletics check", batch 36): added, and passed on for a live roll.
            const bonus = Number(check.bonus?.value) || 0;
            roll = yield { type: "roll", statistic: slug, options: { actor: caster, target: actor, modifier: skill.modifier + adjustment + bonus, dc, traits: plan.traits ?? [], ...(bonus ? { bonus: { value: bonus, type: check.bonus.type ?? "untyped" } } : {}) } };
        } else {
            const slugs = check.saveChoice?.statistics?.length ? check.saveChoice.statistics : [check.statistic];
            // The target's choice (Shadow Blast): its best save.
            const slug = slugs.reduce((best, slug) => (statisticOf(context, actor, slug).modifier > statisticOf(context, actor, best).modifier ? slug : best));
            const save = statisticOf(context, actor, slug);
            const dc = check.against?.dc === "fixed" ? check.against.value : (context.dc ?? statisticOf(context, caster, "spell").dc);
            // (2026-10-13, ability batch 286: the save's own bonus or penalty — a poison's save made 2 harder after a critical hit — and a save rolled
            // twice, the worse kept: misfortune.)
            const bonus = Number(check.bonus?.value) || 0;
            roll = yield { type: "roll", statistic: slug, options: { actor, modifier: save.modifier + adjustment + bonus, dc, ...(bonus ? { bonus: { value: bonus, type: check.bonus.type ?? "untyped" } } : {}), ...(check.misfortune ? { misfortune: true } : {}) } };
        }
        let degree = roll.degree;

        // Post-roll: a degree adjustment (Parch: one degree worse for water creatures).
        const adjustDegree = resolution.degreeAdjustment;
        const predicate = adjustDegree?.predicate;
        if (predicate?.kind === "gm-choice") {
            const key = yield* ask({ id: `degree-adjustment:${target}`, phase: "post-roll", question: predicate.question, options: [{ value: "none", label: "Neither" }, ...predicate.options.map((option) => ({ value: option.key, label: option.label }))], default: "none" });
            const map = predicate.options.find((option) => option.key === key)?.map;
            if (map?.[degree]) degree = map[degree];
        } else if (predicate) {
            const confirm = (question) => ask({ id: `degree-adjustment:${target}`, phase: "post-roll", question, options: [{ value: false, label: "No" }, { value: true, label: "Yes" }], default: false });
            const traits = context.traits?.(actor) ?? actor?.traits ?? [];
            const hasTrait = (predicate.traits ?? []).some((trait) => traits.includes(trait));
            let applies = false;
            if (predicate.kind === "trait-any") applies = hasTrait;
            else if (predicate.kind === "trait-or-gm-confirmed") applies = hasTrait || (yield* confirm(predicate.question));
            else if (predicate.kind === "gm-confirmed") applies = yield* confirm(predicate.question);
            else if (predicate.kind === "immunity-any") {
                const immunities = (context.iwr?.(actor)?.immunities ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.type));
                applies = (predicate.immunities ?? []).some((type) => immunities.includes(type));
            } else if (predicate.kind === "caster") applies = caster !== null && idOf(context, caster, -1) === target;
            else if (predicate.kind === "ally-of-caster") applies = context.allied ? Boolean(context.allied(actor, caster)) : yield* confirm("Is this creature one of the caster's allies?");
            else if (predicate.kind === "note-held") applies = yield* confirm(`Does this creature have "${predicate.label}"?`);
            if (applies && adjustDegree.map?.[degree]) degree = adjustDegree.map[degree];
        }
        degrees[target] = degree;
        rolls[target] = { ...roll, degree };

        const outcome = resolution.outcomes?.[degree];
        if (!outcome) continue;
        const damage = outcome.damage ?? { mode: "none" };
        const rolled = [];
        const shared = damage.mode === "shared" ? damage : damage.mode === "mixed" ? damage.shared : null;
        if (shared) {
            const amounts = sharedOnce ?? (yield* sharedRoll());
            for (const id of shared.sourceComponentIds ?? []) {
                const multiplier = shared.componentMultipliers?.[id] ?? shared.multiplier ?? damage.multiplier ?? 1;
                for (const { instance, amount } of amounts.get(id) ?? []) rolled.push({ instance, amount: Math.floor(amount * multiplier), multiplier });
            }
        }
        // (2026-10-14: damage only against a creature with a trait — Holy Light's extra spirit damage on an unholy target — at the row's
        // multiplier.)
        if (shared && (resolution.conditionalDamage ?? []).length) {
            const traitsOf = context.traits?.(actor) ?? actor?.traits ?? [];
            const multiplier = shared.multiplier ?? damage.multiplier ?? 1;
            for (const entry of resolution.conditionalDamage) {
                if (!entry?.formula || (entry.trait && !traitsOf.includes(entry.trait)) || !(multiplier > 0)) continue;
                for (const { instance, amount } of yield* rollEach(parseDamage(String(entry.formula), { rank: castRank }))) rolled.push({ instance, amount: Math.floor(amount * multiplier), multiplier });
            }
        }
        if (damage.mode === "mixed" || damage.mode === "formulas") {
            // Outcome formulas with rollScope "outcome" are rolled once per degree and shared by the targets with that degree.
            const instances = (damage.formulas ?? []).flatMap((entry) => outcomeFormulaAt(entry, baseRank, castRank));
            if (damage.rollScope !== "outcome") rolled.push(...(yield* rollEach(instances)));
            else {
                if (!outcomeRolls.has(degree)) outcomeRolls.set(degree, yield* rollEach(instances));
                rolled.push(...outcomeRolls.get(degree));
            }
        }
        changes.push(...damageChanges(target, rolled));

        for (const effect of outcome.effects ?? []) {
            // recipient "self": the actor (Trip's critical failure, Escape's success).
            const recipient = effect?.recipient === "self" && caster ? idOf(context, caster, -1) : target;
            // A scope (Feint): off-guard only against one creature's attacks, the actor's or the target's.
            const scope = effect?.scope ? { attacker: effect.scope.against === "target" ? target : caster ? idOf(context, caster, -1) : null, attacks: effect.scope.attacks ?? "any", uses: effect.scope.uses ?? null } : null;
            // (stack, 2026-10-11: "the condition value increases by 1 (to a maximum of 4)" on a later failure — { by, max? }, for the runtime
            // to add to a value the creature already has; escalate: "if already slowed, … Petrified permanently" — { if, slug, value,
            // duration }, the runtime's to apply when the creature already has the first.)
            // (A value the text rolls — Wails of the Damned's "Drained 1d4" — kept as valueRoll for the caller to roll.)
            if (effect?.kind === "condition") changes.push({ op: "condition", target: recipient, slug: effect.slug, value: Number.isFinite(effect.value) ? effect.value : null, duration: effect.duration ?? null, ...(!Number.isFinite(effect.value) && typeof effect.valueRoll === "string" ? { valueRoll: effect.valueRoll } : {}), ...(scope ? { scope } : {}), ...(effect.stack ? { stack: { by: Number(effect.stack.by) || 1, ...(Number.isFinite(effect.stack.max) ? { max: effect.stack.max } : {}) } } : {}), ...(effect.escalate?.slug ? { escalate: { if: effect.escalate.if, slug: effect.escalate.slug, value: Number.isFinite(effect.escalate.value) ? effect.escalate.value : null, duration: effect.escalate.duration ?? null } } : {}) });
            else if (effect?.kind === "end-condition") changes.push({ op: "end", target: recipient, what: { conditions: effect.slugs ?? [effect.slug], from: effect.recipient === "self" ? target : null, ...(effect.stabilize ? { stabilize: true } : {}) } });
            // Temporary Hit Points ("gains 40 temporary Hit Points that last for 1 minute", "6d8 temporary Hit Points"): a fixed
            // amount, or the formula rolled; duration as a condition's, for the runtime.
            // (fromDamage: "temporary Hit Points equal to the damage dealt", this row's damage on this target as rolled.)
            else if (effect?.kind === "temp-hp" || effect?.kind === "heal") {
                const fixed = Number(effect.amount);
                const dealt = rolled.filter(({ instance }) => instance.category !== "persistent").reduce((sum, { amount: rolledAmount }) => sum + rolledAmount, 0);
                const amount = effect.fromDamage ? dealt : Number.isFinite(fixed) ? fixed : (yield* rollEach(parseDamage(String(effect.formula ?? "0")))).reduce((sum, { amount: rolledAmount }) => sum + rolledAmount, 0);
                // Healing on the creature (Drink Blood's "regains 10 Hit Points, gaining any excess as temporary Hit Points").
                if (amount > 0 && effect.kind === "heal") changes.push({ op: "heal", target: recipient, amount, ...(effect.excessAsTemp ? { excessAsTemp: true } : {}) });
                else if (amount > 0) changes.push({ op: "tempHp", target: recipient, amount, duration: effect.duration ?? null });
            }
            // Disarm (the item falls, or the grip weakens) and Swallow Whole: passed on for the runtime to play.
            else if (PASSED_EFFECTS.has(effect?.kind)) changes.push({ op: "effect", target: recipient, effect: passedEffect(effect) });
        }
        const movement = outcome.forcedMovement;
        if (movement && ["push", "pull"].includes(movement.kind) && Number.isFinite(movement.distance)) {
            changes.push({ op: "move", target, kind: movement.kind, distance: movement.distance, direction: movement.direction ?? null, upTo: Boolean(movement.upTo), optional: Boolean(movement.optional) });
        }
        for (const modifier of outcome.modifiers ?? []) {
            // A penalty on the actor itself (Bon Mot's critical failure: "You take the same penalty").
            // (2026-10-13: a bonus on the actor against this target only, "+2 to attack rolls and AC against the target creature": against, for
            // the runtime to scope it.)
            const self = modifier?.recipient === "self" && caster;
            changes.push({ op: "effect", target: self ? idOf(context, caster, -1) : target, effect: { kind: "modifier", modifier }, ...(self && modifier.against === "target" ? { against: target } : {}) });
        }
        for (const note of outcome.noteEffects ?? []) {
            if (note.choiceGroup === "caster-option" && option !== null && note.option !== option) continue;
            // (With the degree: a row that only says "As failure, but…" carries the failure's note — Calm's critical failure.)
            changes.push({ op: "effect", target, effect: { kind: "note", note, degree } });
        }
        // (A condition the creature can't reduce below a value while it lasts — "The sickened value can't be reduced below 1 while the
        // spell is active": passed on for the caller to keep.)
        if (outcome.conditionFloor?.slug) changes.push({ op: "effect", target, effect: { kind: "floor", floor: outcome.conditionFloor } });
        for (const native of outcome.nativeEffects ?? []) {
            const recipient = ["source", "caster", "self"].includes(native.recipient?.actor) && caster ? idOf(context, caster, -1) : target;
            changes.push({ op: "effect", target: recipient, effect: { kind: "native", uuid: native.uuid, label: native.label ?? null } });
        }
        for (const instruction of outcome.manualInstructions ?? []) {
            const text = typeof instruction === "string" ? instruction : instruction?.text;
            if (text) changes.push({ op: "note", audience: "gm", target, text, manual: true });
        }
        if (outcome.affliction && resolution.afflictionHandoff) {
            changes.push({ op: "affliction", target, data: { ...resolution.afflictionHandoff, stage: outcome.affliction.stage ?? 1 } });
        }
        for (const followUp of outcome.followUps ?? []) {
            if (followUp?.kind !== "save") continue;
            // A second save for the affected creature (Phantasmal Calamity): a plan of its own, resolved by this family again.
            // (Its own affliction, "… save or be exposed to jungle drake venom": the poison's save after the first, handed on as the poison's.)
            const handoff = followUp.afflictionHandoff ?? null;
            const followUpPlan = { modelVersion: plan.modelVersion, source: { ...(plan.source ?? {}), name: `${plan.source?.name ?? "Spell"} (follow-up)` }, rank: plan.rank, targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: SAVE_KIND, check: followUp.check, sharedDamage: handoff ? null : resolution.sharedDamage ?? null, outcomes: followUp.outcomes, ...(handoff ? { afflictionHandoff: handoff } : {}) } };
            changes.push({ op: "followUp", target, plan: followUpPlan, when: "now" });
        }
        if (outcome.terminal?.kind === "death") changes.push({ op: "death", target });
        if (resolution.postDamageTerminal?.kind === "death" && rolled.some(({ instance, amount }) => amount > 0 && instance.category !== "persistent")) {
            // Disintegrate: the target dies if this damage reduces it to 0 HP.
            changes.push({ op: "death", target, ifReducedTo: resolution.postDamageTerminal.threshold ?? 0 });
        }
    }

    // Text for the GM: reminders and data notes.
    for (const reminder of [...(resolution.reminders ?? []), ...(resolution.dataNotes ?? [])]) {
        const text = typeof reminder === "string" ? reminder : reminder?.text;
        if (text) changes.push({ op: "note", audience: "gm", text });
    }

    return { degrees, rolls, changes, decisions, records: [], gaps: saveGaps(plan) };
}

export const resolveSave = (plan, context, io) => drive(saveSteps(plan, context), io);
export const resolveSaveSync = (plan, context, io) => driveSync(saveSteps(plan, context), io);

export const saveFamily = Object.freeze({
    kind: SAVE_KIND,
    module: "pf2e-resolution-core",
    validate: validateSave,
    steps: saveSteps,
    resolve: resolveSave,
    gaps: saveGaps
});
