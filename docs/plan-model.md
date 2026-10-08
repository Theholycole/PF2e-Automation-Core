# Shared plan model: design draft

**Status:** a draft for review by the spell-automation session and the user, written on 2026-10-08. No code yet. Milestone 2 (building the core) waits until the spell module's cleanup is finished and the user picks a start date.

**Goal:** one plan format and one resolver for three modules.

- **Spells** (`pf2e-automatic-resolution`) and **abilities** (`pf2e-automatic-ability-resolution`) compile into plans.
- The **core** (`pf2e-resolution-core`) resolves a plan into a list of changes.
  - In live play, the Foundry apply layer turns the changes into a confirmation card, then into document updates.
  - In the Combat Simulator, the same changes are applied to in-memory state, and an AI makes every choice a person would.

## 1. Start from the spell compiler's model

The spell compiler's plans (model version 12) already have the right skeleton. A run over 1,994 spells compiled them all, with about 150 resolution kinds:

| Plan field | Holds |
|---|---|
| `source`, `rank`, `traits` | what the ability is |
| `activation` | `time` ("1", "2", "1 to 3", reaction, free), traits, requirements, cost |
| `targeting` | `target`, `range`, `area` (`{ type: "burst", value: 20 }`), actor constraints |
| `trigger` | `event`, `timing`, `frequency`, `immunity` |
| `decisionWindows` | when the GM can intervene (before the roll, before applying, rerolls) |
| `lifecycle` | duration, sustained, controller, termination |
| `resolution` | `kind`, `check` (`statistic`, `basic`, `dcSource`), `sharedDamage`, `outcomes` |
| `resolution.outcomes[degree]` | `damage`, `effects` (e.g. `{ kind: "condition", slug: "frightened", value: 2 }`), `modifiers`, `followUps`, `decisions`, `manualInstructions`, `terminal`, `rawText`, `semanticCoverage` |
| `automation` | level (automatic, prompted, guided, unsupported), confidence, capabilities |
| `diagnostics`, `delegations` | what wasn't compiled and why |

**Proposal: the core adopts this model as version 13.** All additions are optional fields, so every version-12 spell plan stays a valid version-13 plan. The spell compiler doesn't need to change to move into the core.

## 2. What abilities need that spells don't

The census of PF2e's non-spell abilities (`PF2e AUTOMATIC ABILITY RESOLUTION/docs/census.md`) shows the shapes that matter:

- **saves:** about 5,400 monster uses
- **Strike riders:** about 4,500
- **checks against a target's DC:** about 1,100 monster uses, plus every PC's basic actions
- **auras**, healing, stances, reactions

Most fit the model with a few additions.

### 2.1 Checks against a target's DC (Trip, Grapple, Demoralize, Escape)

Today `check.statistic` names a save or `spell-attack`, and the DC comes from the source. Abilities often turn that around: the **user rolls a skill against the target's DC**. Proposal: an optional `against` field.

```js
check: {
  roll: "skill",                    // "save" (default, today's meaning) | "skill" | "attack" | "perception" | "flat"
  statistic: "athletics",           // or ["acrobatics", "athletics"] when the user picks the better one (Escape)
  against: { dc: "target", statistic: "reflex" },  // Trip: Athletics vs the target's Reflex DC
  // other forms: { dc: "fixed", value: 15 } (Battle Medicine), { dc: "source", statistic: "class" }
  //              { dc: "grabber", statistic: "athletics" } (Escape against whoever grabbed you)
}
```

`outcomes` stay keyed by degree, from the roller's side, as they are for spell attacks.

### 2.2 Strike riders (Grab, Knockdown, Push, Rend, Power Attack's extra dice)

Riders hang off a Strike instead of being used on their own. Proposal: a `trigger` event plus a link to the Strikes they ride on.

```js
trigger: {
  event: "strike",                  // new: fires on the user's Strike
  on: ["success", "criticalSuccess"], // Strike degrees that set it off
  strikes: { slugs: ["jaws"] },     // or { attackEffect: "grab" } to follow PF2e's melee attackEffects
  cost: "free"                      // Improved Grab; "action" for Grab (spend 1 action after the hit)
}
resolution: { kind: "rider", outcomes: { success: { effects: [{ kind: "condition", slug: "grabbed", target: "struck" }] } } }
```

Rend ("hit with two claws in one turn") needs a turn memory, so it gets a small `requires: { strikesThisTurn: { slugs: ["claw"], hits: 2 } }`.

### 2.3 Action sequences and modified Strikes (Sudden Charge, Double Slice, Power Attack)

Many PC feats are "do these basic actions, with these changes". Proposal: `resolution.kind: "action-sequence"` with steps the resolver already knows.

```js
resolution: {
  kind: "action-sequence",
  steps: [
    { do: "stride", times: 2 },
    { do: "strike", modifiers: [], mapCountsAs: 1 }
  ]
}
// Power Attack: [{ do: "strike", extraDice: 1, mapCountsAs: 2 }]
// Double Slice: [{ do: "strike", hand: "main" }, { do: "strike", hand: "off", mapSharedPenalty: true }]
```

The simulator already has Strike and Stride built in, so these become cheap once the step vocabulary is shared.

### 2.4 Limits: frequency and per-target immunity

`trigger.frequency` and `trigger.immunity` exist already. Proposal: give them a structured form, keeping the text alongside.

```js
frequency: { max: 1, per: "round" | "turn" | "minute" | "10-minutes" | "hour" | "day" | "encounter", raw: "once per round" }
immunity:  { scope: "target", duration: "10-minutes", raw: "…temporarily immune for 10 minutes" }  // Demoralize, Battle Medicine (1 day)
```

### 2.5 Stances and auras

- **Stances:** `lifecycle.stance: true`. Entering a stance ends the user's other stances, and the stance's Effect carries its rule elements.
- **Auras:** `targeting.area: { type: "emanation", value: 30 }` plus `trigger.event: "aura"` with `when: "enter" | "start-turn" | "end-turn"` and the existing `check`/`outcomes`. Frightful Presence: Will save against the source's DC on entering or starting a turn in it; on failure, frightened; immunity for 1 minute.

### 2.6 Reactions

`activation.time: "reaction"` plus a structured trigger:

```js
trigger: { event: "reaction", when: "targeted-by-attack" | "hit" | "reduced-to-0-hp" | "ally-hit" | "enemy-moves-within-reach", raw: "…" }
```

Examples: Nimble Dodge (+2 AC against the triggering attack), Ferocity (stay at 1 HP), Shield Block.

### 2.7 Healing outside spells

These need nothing new:

- **Battle Medicine:** `check: { roll: "skill", statistic: "medicine", against: { dc: "fixed", value: 15 } }`, plus `immunity: { scope: "target", duration: "day" }`, with outcomes that carry healing.
- **Potions:** `activation.time: "1"` (Interact), with an outcome-free `healing` resolution.

## 3. The resolver contract

The core's pure layer turns a plan into changes and never touches Foundry:

```js
resolve(plan, context, { rolls, choose }) → { degree, changes: Change[], pendingDecisions: Decision[] }

// context: the user, the targets and the situation as plain data (the simulator's snapshot
//          format, or an adapter over Foundry documents)
// rolls:   pre-rolled or rolled through a supplied function, so the simulator can seed them
// choose:  answers decisions (live: a chat-card prompt; simulator: the planner)

Change =
  | { op: "damage", target, instances: [{ type, amount, persistent, precision }] }
  | { op: "heal", target, amount }
  | { op: "condition", target, slug, value, duration }
  | { op: "effect", target, effect }        // a PF2e Effect item, by reference or generated
  | { op: "move", target, kind: "push" | "pull" | "stride", distance }
  | { op: "resource", target, key, delta }  // spell slots, focus points, uses per day
  | { op: "note", audience: "gm" | "all", text }
```

- **Live play:** the apply layer shows the card (confirmation-first for everything, as the user decided for the ability module), then turns each change into document updates.
- **Simulator:** each change is applied to its state. Anything that can only be a note is counted as a gap.

## 4. Registry

Content modules register families instead of depending on each other:

```js
core.registerFamily({
  kind: "rider",            // resolution.kind it handles
  module: "pf2e-automatic-ability-resolution",
  resolve(plan, context, io) { … },  // pure
  simulate?: { … }          // optional extras for the simulator (e.g. how to value it when planning)
});
core.planFor(item)          // a plan for an item from whichever module compiled it (cached)
```

The simulator asks `core.planFor(item)` for every ability on a creature. Anything without a plan or a registered family stays a gap, as now.

## 5. What the core owns from day one

These come from the spell-automation session. If two modules each kept a copy, PF2e functions would be wrapped twice and hooks would fire twice.

- the `applyDamage` wrapper (damage types, the damage's item and actor, `damageSource` on PF2e's damage-taken message, spell-shield marking on Shield Block)
- the text-rules wrapper of `ItemPF2e#prepareRuleElements`
- damage receipts, forced movement, condition timing
- the ongoing journal manager and its single-coordinator queue
- the convention that chat-card handlers skip messages with `flags.pf2e.context.type`

One more from the simulator's own testing: hooks that run on every Combat update must be cheap or guarded. Combat updates happen on every turn change, and in `pftest` one hook made each update cost 0.5–1.3 s.

## 6. Order of work once milestone 2 starts

1. Create the core module with the version-13 model (version 12 plus the optional fields above), a validator, the registry and the change format. No behaviour moves yet.
2. Move the shared Foundry pieces from section 5 into the core, with the spell module depending on it. That module's tests must stay green.
3. Move families one at a time, in the order the simulator needs them, each split into a pure resolver plus the apply layer (the `basic-save-core` pattern):
   1. basic saves and spell attacks
   2. healing
   3. condition riders
   4. the most common gaps after that, from the simulator's gap report
4. The simulator switches its gap list from "has a spell" to "has no registered family for this plan".

## 7. Questions for review

For the spell-automation session:

1. Is version 13 as "version 12 plus optional fields" right, or are there version-12 fields you'd rather rename or drop while it's cheap?
2. `check.statistic: "spell-attack"` already reverses roller and DC for spell attacks. Is `check.roll` plus `check.against` the right generalisation, or would you model it differently?
3. Where do decisions live today: only in `outcomes[degree].decisions`, or also before the roll (choosing targets, variants, rank)? The `choose` interface has to cover all of them.
4. For section 5, which hooks must the core own on day one, and which can move later?
5. Is anything in the version-12 runtimes impossible to express as `Change` ops (something that must touch Foundry mid-resolution)?

For the user:

6. Is confirmation-first for everything also right for spells once they share the core? It's the spell module's current behaviour, so the expected answer is yes.
