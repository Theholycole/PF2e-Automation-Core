// Plain text from PF2e's HTML, and stated durations. Moved from the spell
// module's src/compiler/description-parser.js (2026-10-08, unchanged).

function decodeEntities(text) {
    return String(text ?? "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)));
}

export function htmlToPlainText(html) {
    return decodeEntities(String(html ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<\/li\s*>/gi, "\n")
        .replace(/<hr\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " "))
        .replace(/[\t\r ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
}

/** A stated duration ("10 minutes", "1 hour"; rounds too when allowed) in seconds, or null. */
export function durationSeconds(text, { rounds = false } = {}) {
    const match = /^(\d+) (round|minute|hour)s?$/i.exec(String(text ?? "").trim());
    if (!match || (!rounds && /round/i.test(match[2]))) return null;
    return Number(match[1]) * { round: 6, minute: 60, hour: 3600 }[match[2].toLowerCase()];
}
