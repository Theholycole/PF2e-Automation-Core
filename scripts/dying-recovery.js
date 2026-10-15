// Coming back from Dying — shared by the content modules (2026-10-15, asked by the item module: a healing potion fed to a dying ally). Moved
// from the spell module (scripts/dying-recovery.js) unchanged, as runtime-utils was; the spell module forwards to it when its session chooses.
//
// Coming back from Dying. PF2e 8.5 leaves Dying to the table when a creature is healed. By the rules, a creature
// with 1 Hit Point or more loses Dying and wakes up, and losing Dying gives Wounded 1 (or +1). A spell may say that
// coming back this way doesn't increase Wounded (Rebuke Death). Used by every module route that restores Hit Points.

/** Whether the creature is dying now (read before the healing is applied). */
export function isDying(actor) {
    return actor?.hasCondition?.("dying") === true;
}

/**
 * After healing: a creature that was dying and now has 1 HP or more loses Dying and Unconscious, and gains Wounded
 * unless `keepWounded`. Returns what changed, or null when nothing did.
 */
export async function recoverFromDying(actor, wasDying, { keepWounded = false } = {}) {
    if (!wasDying || !(Number(actor?.hitPoints?.value ?? actor?.system?.attributes?.hp?.value) >= 1) || !isDying(actor)) return null;
    const woundedBefore = actor.getCondition?.("wounded")?.value ?? 0;
    await actor.decreaseCondition("dying", { forceRemove: true });
    if (actor.hasCondition?.("unconscious")) await actor.decreaseCondition("unconscious", { forceRemove: true });
    if (!keepWounded) await actor.increaseCondition("wounded");
    return { woundedBefore, woundedAfter: actor.getCondition?.("wounded")?.value ?? 0, woundedRaised: !keepWounded };
}

/** "No longer dying; Wounded 0 → 1." for result cards. */
export function revivedNote(revived) {
    return `No longer dying (awake); Wounded ${revived.woundedBefore} → ${revived.woundedAfter}${revived.woundedRaised ? "" : " (this spell doesn't increase it)"}.`;
}
