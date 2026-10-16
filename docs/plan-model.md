# Shared plan model: design draft (version 2)

**Status:** design only, no code. Revised on 2026-10-08 after review by the spell-automation session ("PF2e automation handoff"), whose answers are folded in below and noted as *(review)*. Milestone 2 starts when that session finishes its cleanup and the user picks a date.

**Goal:** one plan format and one resolver for three modules.

- **Spells** (`pf2e-automatic-resolution`) and **abilities** (`pf2e-automatic-ability-resolution`) compile into plans.
- The **core** (`pf2e-resolution-core`) resolves a plan into **changes** and **decisions**.
- **In live play,** the Foundry apply layer asks the decisions on a confirmation card, then turns the changes into document and scene updates. Live play stays confirmation-first for everything: every compiled spell plan already has `decisionWindows.applicationRequiresConfirmation: true`, and the user chose the same for abilities.
- **In the Combat Simulator,** the same changes are applied to in-memory state, and its planner answers the decisions.

## 1. The model: version 13 = version 12 + optional fields

The spell compiler's plans (model version 12) are the base. In the current compile of the 1,994 official spells:

- there are **193 resolution kinds**
- the shared skeleton is only the top level; the real content sits in **per-kind payloads on `resolution`**, with **338 distinct keys** *(review)*

| Plan field | Holds |
|---|---|
| `source`, `rank`, `traits` | what the ability is |
| `activation` | `time` ("1", "2", "1 to 3", reaction, free), traits, requirements, cost |
| `targeting` | `target`, `range`, `area`, actor constraints |
| `trigger` | `event`, `timing`, `frequency`, `immunity` |
| `decisionWindows` | GM intervention points and reroll policies |
| `lifecycle` | duration, sustained, controller, termination |
| `resolution` | `kind`, `check`, `sharedDamage`, `outcomes`, and the kind's own payload |
| `resolution.outcomes[degree]` | `damage`, `effects`, `modifiers`, `followUps`, `manualInstructions`, `terminal`, `rawText`, `semanticCoverage` |
| `automation`, `diagnostics`, `delegations` | coverage and what wasn't compiled |

A **follow-up** (`outcomes[degree].followUps: [{ kind: "save", check, outcomes, afflictionHandoff? }]`) is a second save for the creature, resolved as a plan of its own. With `afflictionHandoff` (2026-10-12) it is an affliction's save after a first one ("… save or be exposed to jungle drake venom"): its rows' `affliction` stages are handed on as the affliction's.

The most common payload keys are `applications` (1,146 plans), `note` (436), `reminders` (213), `lingering` (133), `incarnate` (86), `dataNotes`, `effectNote`, `temporaryImmunity`, `recipient`, `modes`, `operations`, `heightened`, `casterChoice`, `ritualDegrees`, `afflictionHandoff`, `degreeAdjustment`, `attackAdjustment`, `controls`, `summon` and `storedTrigger`.

**Rules:**

- **No renames** *(review)*. Renaming a version-12 field would mean touching 1,994 official and 227 third-party plans plus their readers and runtimes. Where a cleaner shape helps, the core's **reader normalises** on the way in and the stored plans stay as they are. Example: `check.statistic: "spell-attack"` is read as `{ roll: "attack", statistic: "spell", against: { dc: "target", statistic: "ac" } }`.
- **Validation is per family** *(review)*. The core validates only the shared skeleton. Each registered family validates its own `resolution` payload.

## 2. Additions abilities need

These all come from the census of non-spell abilities in `PF2e AUTOMATIC ABILITY RESOLUTION/docs/census.md` (monster use counts):

- saves: about 5,400
- Strike riders: about 4,500
- checks against a target's DC: about 1,100, plus PCs' basic actions

All the additions below are optional.

### 2.1 Checks: `check.roll` and `check.against`

```js
check: {
  roll: "save" | "skill" | "attack" | "perception" | "flat" | "counteract",
  statistic: "athletics" | ["acrobatics", "athletics"],   // a list: the roller picks the better one (Escape)
  against: { dc: "target", statistic: "reflex" }           // Trip
         // { dc: "fixed", value: 15 }                     Battle Medicine
         // { dc: "source", statistic: "class" }           a monster's ability DC
         // { dc: "grabber", statistic: "athletics" }      Escape
         // { dc: "effect", rank }                         counteract (see below)
  perTarget: true                                          // one roll, a degree per target
}
```

Outcomes stay keyed from the roller's side, as spell attacks already are. Three cases spell plans already need *(review)*:

- **One roll against several targets' DCs, with a degree per target** (`perTarget: true`). Example: Liar's Lexicon, Deception against every observer's Perception DC.
- **A spell attack against a save DC instead of AC.** A spellshape rider switches `against.statistic`.
- **Counteract checks.** The degree comes from the counteract rank against the target's rank, not only from beating the DC. This uses `roll: "counteract"`, `against: { dc: "effect", rank }`, and a shared counteract rule in the core.

### 2.2 Strike riders

```js
trigger: { event: "strike", on: ["success", "criticalSuccess"], strikes: { attackEffect: "grab" } | { slugs: ["jaws"] }, cost: "action" | "free" }
resolution: { kind: "rider", requires?: { strikesThisTurn: { slugs: ["claw"], hits: 2 } }, outcomes: { … } }
```

Covers Grab, Improved Grab, Knockdown, Push and Rend (the `requires` part is Rend's "hit with two claws this turn").

### 2.3 Action sequences

```js
resolution: { kind: "action-sequence", steps: [{ do: "stride", times: 2 }, { do: "strike", mapCountsAs: 1 }] }
// Power Attack: [{ do: "strike", extraDice: 1, mapCountsAs: 2 }]
```

Covers Sudden Charge, Power Attack and Double Slice.

### 2.4 Structured limits

```js
frequency: { max: 1, per: "round" | "turn" | "minute" | "10-minutes" | "hour" | "day" | "encounter", raw }
immunity:  { scope: "target", duration: "10-minutes", raw }
```

The text stays alongside the structured form.

### 2.5 Stances, auras and reactions

- **Stances:** `lifecycle.stance: true`. Entering one ends the user's other stances.
- **Auras:** `targeting.area: { type: "emanation", value }` plus `trigger: { event: "aura", when }`. Example: Frightful Presence.
  - `when` is a list of `"enter"`, `"start-turn"` and `"end-turn"` (a single string is read as a list of one). An empty list means the aura acts on some other trigger, such as a creature Casting a Spell in it, and live play leaves it to the GM.
  - `oncePerRound: true`: a damage-only aura, which Monster Core has hit a creature that enters it or starts its turn in it, once per round.
  - `activeAfter: { ability, rounds }`: the aura acts only for that long after the named ability (Miasma after Poison Breath).
  - A passive ability that isn't an aura (Death Throes, Defensive Quills) has `trigger.event: "passive"`.
- **Penalties and bonuses as outcomes:** `outcomes[degree].modifiers: [{ selector, value, type, duration, recipient? }]` in PF2e's FlatModifier terms ("takes a –2 status penalty to Perception and Will saves for 1 minute" → selectors `perception` and `will`, value −2, type `status`). Each becomes `{ op: "effect", target, effect: { kind: "modifier", modifier } }`, on the actor when `recipient` is `"self"`.
- **Conditions while in an aura:** a condition's `duration: { mode: "in-aura", after? }` lasts while the creature stays in the aura ("while it remains in the area"). `after: { value, unit }` keeps it that long after leaving ("persists for 3 rounds after leaving the aura", "recovers after it has been out of the aura for 1 minute"). The core passes it through; live play ends it when the creature leaves; the simulator counts it as the whole fight.
- **Immunity:** `trigger.immunity: { scope: "target", raw, duration: { value, unit }, degrees, against }`. `degrees` lists the results that grant it ("A creature that succeeds …"); `against` is `"source"` (this creature's ability) or `"all"` ("immune to all stench auras"). Live play records it as an effect on the creature.
- **Reactions:** `activation.time: "reaction"` plus `trigger: { event: "reaction", when: "targeted-by-attack" | "hit" | "reduced-to-0-hp" | "ally-hit" | "enemy-moves-within-reach", raw }`.

### 2.6 Healing outside spells

No new fields. Battle Medicine is a fixed-DC Medicine check with a 1-day per-target immunity. Potions are an Interact action with healing.

## 3. Decisions are typed and phased

`outcomes[degree].decisions` is empty in every compiled plan *(review)*. Decisions actually live in several places, at different moments *(review)*:

| Phase | Where they are today | Examples |
|---|---|---|
| `pre-cast` | runtime prompts; `variantPlans`; `resolution.casterChoice` (32 plans), `modes` (35), `summon`; effect-choice forms; spellshape and catalyst riders | action count, rank, targets, area placement, damage type, option, which creature, Illusory Creature size, Repulsion radius |
| `pre-roll` | `resolution.attackAdjustment` (17) | a GM question with valued choices that sets a modifier: Charm +4, Phase Bolt cover |
| `post-roll` | `resolution.degreeAdjustment` (21); `decisionWindows` reroll policies | "Was the creature flying?" with a degree map; rerolls |
| `apply` | "is it affected" confirmations | per-target confirmation |
| `ongoing` | `resolution.controls` (17); Sustain and `repeatable`; `review-targets` and `gm-hazard` obligations; stored-trigger results | GM buttons; Sustain choices; Mirror Image hit, miss or critical |

So the resolver yields **typed decisions**:

```js
Decision = { id, phase, question, options: [{ value, label, effect? }], default?, audience: "gm" | "owner" }
```

- `id` is stable, so the simulator answers the same question the same way, and the live card can prompt for it.
- **Live play:** the apply layer asks them on the card, in phase order.
- **Simulator:** the planner answers them, scoring options where an `effect` says what each does, otherwise taking the default.

## 4. The resolver contract

```js
resolve(plan, context, io) → { degrees, changes: Change[], decisions: Decision[], records: OngoingRecord[] }
resolveEvent(record, event, context, io) → { changes, decisions, record }   // ongoing state machines (review)

io.roll(statistic, { modifiers, rollOptions, against })   // a roller service, not a list of numbers (review)
io.choose(decision) → value
```

**Rolls.** `io.roll` takes modifiers and roll options and returns a degree. The live roller routes through PF2e's `Statistic.roll`, including the d20 clamp, fortune and misfortune, rerolls and degree maps. The simulator supplies a seeded roller with the same interface.

**Context services.** Pure code can't read Foundry, so these are services on `context` *(review)*:

- `context.statistic(actor, slug)`: modifiers and roll options
- `context.iwr(actor)`: immunities, weaknesses, resistances, applied the way PF2e's `applyDamage` does
- `context.distance(a, b)`, `context.inArea(actor, area)`, `context.blocked(from, to)`: canvas geometry, including walls stopping forced movement

The simulator implements them on its range bands. The live layer implements them on the canvas.

**Change ops.** Extended with the cases live runtimes need *(review)*:

```js
Change =
  | { op: "damage", target, instances }            | { op: "heal", target, amount }
  | { op: "tempHp", target, amount }                | { op: "condition", target, slug, value, duration }
  | { op: "effect", target, effect }                | { op: "end", target, what }          // end an effect or spell (counteract, dismiss)
  | { op: "item", action: "create" | "update" | "delete", target, data }   // incl. rule patches, duration swaps, conjured items
  | { op: "move", target, kind: "push" | "pull" | "stride", distance }
  | { op: "teleport", target, to }                  | { op: "elevate", target, delta }
  | { op: "size", target, size }                    | { op: "ownership", target, owner }   // minion control
  | { op: "spawn", what: "token" | "actor", data }  // summons, conjured creatures, illusions, thralls
  | { op: "scene", what: "region" | "wall" | "light", action, data }   // areas, terrain, clouds, Wall of Force
  | { op: "ongoing", action: "start" | "advance" | "end", record }
  | { op: "followUp", plan, when: "now" | event }   // a follow-up card whose button starts another resolution
  | { op: "affliction", target, data }              // hand-off to Pseudo Afflictions
  | { op: "resource", target, key, delta }          | { op: "note", audience, text, manual? }
  | { op: "death", target, ifReducedTo? }           // death effects (added in step 3.1)
```

The simulator applies what it can model (damage, healing, temporary HP, conditions, effects it understands, movement in bands, ending effects, resources) and counts the rest as gaps. That keeps the gap report honest.

Damage materials (2026-10-16, for the item module's "treated as silver"): a damage formula's flavor words in PF2e's `CONFIG.PF2E.materialDamageEffects` ("3d8[fire,silver]") and a component's own `materials` are kept on the parsed instance as `materials`, and a `damage` change's instance (or a `persistent-damage` condition's `damage`) carries them. An instance without one has no `materials` field, as before. Live play writes them back into the roll's flavor; the simulator weighs a weakness or resistance to them.

Additions for the skill actions (milestone 3, 2026-10-08):
- A `condition` change can carry `scope: { attacker, attacks: "any" | "melee", uses }`: off-guard only to that creature's attacks, for that many of them (`null`: every one while it lasts). Used by Feint and Create a Diversion.
- An `effect` change of kind `disarm` (`{ kind: "disarm", what: "drop" | "weaken", penalty }`) knocks a held item away or weakens the grip on it.
- An `effect` change of kind `swallow` (`{ kind: "swallow", damage, rupture, size }`) is Swallow Whole: the target is swallowed, takes `damage` at the end of each of its turns, and cuts itself free when the swallower takes `rupture` piercing or slashing damage from one attack.
- An `end` change's `what` can say `stabilize: true` (Administer First Aid): dying ends, but the creature stays unconscious.
- The ability module's creature afflictions give `affliction` changes whose `data` has the stages in numbers: `{ name, traits, statistic, dc, maximumDuration, onset, stages: [{ stage, damage: [formula], conditions: [{ slug, value }], duration: { value, unit }, death? }], stage }`. The spell module's hand-offs keep their stages as text.

## 5. Registry

```js
core.registerFamily({ kind, module, validate(payload), resolve(plan, context, io), resolveEvent?, simulate? })
core.planFor(item)   // the compiled plan from whichever module owns the item (cached)
```

## 6. What the core owns

**From day one: anything that patches a shared prototype or claims a shared message** *(review)*:

1. the `Actor.prototype.applyDamage` wrapper (`installDamageTypeMemory`, `scripts/item-spellshape-runtime.js`) and its preCreateChatMessage `damageSource` stamp
2. `ItemPF2e.prototype.prepareRuleElements` (`scripts/text-rules.js`)
3. `CheckRoll.prototype.evaluate` (`scripts/d20-clamp.js`): fortune and minimum-roll abilities in the ability module would collide with it
4. the `_getTerrainEffects` / modifyMovementCost patch (`patchSelectiveTerrain`, `scripts/main.js`): per-creature difficult terrain, which the ability module also needs
5. the conventions: only the active GM acts on hooks; chat-card handlers skip messages with `flags.pf2e.context.type`; hooks that fire on every Combat update must be cheap or guarded (one hook cost 0.5–1.3 s per update in `pftest`)

**Later:**

- **As they're needed** (they patch nothing and can be imported until then): damage receipts, forced movement, condition timing.
- **Before the ability module's aura family:** the ongoing journal manager and its single-coordinator queue. There must be exactly one. (2026-10-08: the ability module's aura cards keep no ongoing records. They read positions when a token moves and when a turn starts or ends, so they don't need the journal. Lingering areas will.)
- **Eventually:** a single HP-change pipeline, once the ability module adds preUpdateActor HP interceptors of its own, so their order is defined. The spell module's existing ones (halved healing, no healing, covenant, HP pact) stay there until then.
- **First inhabitants:** the helpers the cleanup is collecting into `scripts/runtime-utils.js` and `src/compiler/text-patterns.js`.

## 7. Order of work once milestone 2 starts

1. **Core module scaffold:**
   - the skeleton validator and the reader normalisation
   - the registry
   - the Decision, Change and OngoingRecord formats, and the `io` and context-service interfaces
   - `runtime-utils.js` and `text-patterns.js` as its first code
2. **Day-one ownership:** move the shared prototype patches and conventions from section 6 into the core, with the spell module depending on it. That module's tests and a live regression run must stay green.
3. **Families one at a time, as real splits** *(review)*. The spell runtimes are imperative executors today (EffectRuntime alone has about 370 methods), so each family is split into a pure resolver plus the apply layer, copying `basic-save-core.js`. Order, driven by the simulator:
   1. basic saves and spell attacks (already split). **Built 2026-10-08** as the core's `save` family (`src/families/save.js`), written as steps (`src/drive.js`) so it runs sync in the simulator and async live. All 740 compiled `save` plans resolve and 436 have no gaps. It added one op, `{ op: "death", target, ifReducedTo? }`.
   2. healing and temporary HP. **Built 2026-10-08** (healing; temporary HP is still to come): the `healing` and `direct-damage` families and Heal's healing half in `save`, on optional payloads the spell compiler fills from PF2e's item data. `resolution.healing` is `{ components, heightening, recipients }`, `resolution.byActions` holds action overlays, and `resolution.missiles` holds `{ perActions, perRanks }`.
   3. condition riders
   4. then the most common gaps in the simulator's gap report
4. **Simulator switch:** a creature's ability counts as a gap only when it has no plan or its plan's kind has no registered family.

## 8. Settled

- Version 13 = version 12 + optional fields, normalised in the reader, with no renames.
- `check.roll` and `check.against`, plus per-target degrees, defence switching and counteract.
- Decisions are typed and phased; the resolver has `resolveEvent` for ongoing records; rolls go through a roller service; geometry and IWR come through context services.
- The Change ops list above, and the day-one ownership list.
- Live play stays confirmation-first for spells and abilities. The user confirmed this for spells sharing the core on 2026-10-08.

## 9. Still open

- Exactly what the context services return: the live canvas has precise geometry, and the simulator only has bands. An agreed lowest common denominator (distance in feet, inside an area or not, path blocked or not) is probably enough. To agree at milestone 2's start.
- How `followUp` cards and `ongoing` records behave in the simulator: probably resolved on the matching simulated event (start of turn, Sustain), with anything else counted as a gap.
