// (2026-11-11, Cole: "any time an effect wouldn't be applied due to an immunity on a creature, make sure there is a message to the GM".) The
// pure half of the GM's immunity notices (scripts/immunity-notice.js sends them): the words, the key that keeps one notice from being sent
// twice in a row, and which of a creature's immunities blocks an effect.

const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

/**
 * A notice's fields, cleaned: { target, blocked, why?, source? } (plain words). target: who was spared ("Goblin Warrior", or several
 * "Goblin Warrior, Goblin Pyro"); blocked: what wasn't applied ("Frightened 2", "Pinned Fizz's blinded"); why: the immunity ("immune to
 * fear effects", "temporarily immune for 10 minutes"); source: what it came from ("Demoralize").
 */
export function noticeFields({ target, blocked, why = null, source = null } = {}) {
    const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
    return { target: text(target) || "A creature", blocked: text(blocked) || "an effect", why: text(why) || null, source: text(source) || null };
}

/** The GM's line: "<strong>Immunity</strong>: Goblin Warrior isn't affected by Frightened 2 from Demoralize (immune to fear effects)." */
export function noticeHTML(fields) {
    const { target, blocked, why, source } = noticeFields(fields);
    const from = source && source.toLowerCase() !== blocked.toLowerCase() ? ` from ${escape(source)}` : "";
    return `<p><strong>Immunity</strong>: ${escape(target)} isn't affected by ${escape(blocked)}${from}${why ? ` (${escape(why)})` : ""}.</p>`;
}

/** One key per notice, so the same one sent twice within moments (two clients, a re-render) is posted once. */
export function noticeKey(fields) {
    const { target, blocked, why, source } = noticeFields(fields);
    return [target, blocked, why ?? "", source ?? ""].join("|").toLowerCase();
}

/** Whether a notice with this key went out within the last `windowMs` (and records it if not). seen: Map key → time. */
export function seenRecently(seen, key, now, windowMs = 2000) {
    for (const [old, at] of seen) if (now - at > windowMs) seen.delete(old);
    if (seen.has(key)) return true;
    seen.set(key, now);
    return false;
}

/**
 * The words for the immunity of a creature's that blocks an effect, given its immunities (PF2e's Immunity objects: { type, label?, test? })
 * and the effect's roll-option statements: "immune to fear effects". Its label when PF2e gives one, else its type in words.
 */
export function immunityWords(immunities, statements) {
    const list = [...(immunities ?? [])];
    const found = list.find((immunity) => {
        try {
            return typeof immunity?.test === "function" ? immunity.test(statements) : false;
        } catch {
            return false;
        }
    });
    if (!found) return null;
    return typeWords(found.label ?? found.type);
}

/** "fear-effects" → "immune to fear effects"; a PF2e label ("Immunity: Fear Effects" or "Fear Effects") → "immune to fear effects". */
export function typeWords(type) {
    const text = String(type ?? "").replace(/^\s*immun(?:e|ity)\s*(?:to)?\s*:?\s*/i, "").replace(/-/g, " ").trim();
    return text ? `immune to ${text.toLowerCase()}` : "immune";
}
