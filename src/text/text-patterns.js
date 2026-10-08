// Text patterns and small helpers the compiler readers share. Moved from the spell module (src/compiler/text-patterns.js, 2026-10-08,
// unchanged). Each reader imports what it uses under its own local name.
import { htmlToPlainText, durationSeconds } from "./plain-text.js";

// Rule words: a sentence with any of these states a rule, not narration (a reader claims narration only without them). Each variant is the word list one
// family of readers settled on; Propagating Arc's narration says "until the area around the target is filled", so its list (NO_UNTIL) leaves "until" out.
export const NARRATION_RULES = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|until|terrain)\b/i;
export const NARRATION_RULES_ATTACK = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|until|rounds?|minutes?|attack)\b/i;
export const NARRATION_RULES_CHECKS = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|immune|can't|must|checks?|DC|Hit Points|Strikes?)\b/i;
export const NARRATION_RULES_COVER = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|until|terrain|cover)\b/i;
export const NARRATION_RULES_NO_DAMAGE = /\d|@|\[\[|\b(?:saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|until|terrain)\b/i;
export const NARRATION_RULES_NO_TERRAIN = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|until)\b/i;
export const NARRATION_RULES_NO_UNTIL = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|terrain)\b/i;
export const NARRATION_RULES_SHORT = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|must|until|terrain)\b/i;
export const NARRATION_RULES_TIMED = /\d|@|\[\[|\b(?:damage|saves?|bonus|penalty|conditions?|immune|Sustain|can't|must|each|until|rounds?|minutes?)\b/i;
export const RULE_WORDS_BROAD = /\d|@|\[\[|\b(?:damage|saves?|saving throws?|checks?|DCs?|bonus|penalty|conditions?|immune|immunity|Hit Points|attacks?|Speeds?|weakness|resistance)\b/i;
export const RULE_WORDS_PLAIN = /\d|\b(?:damage|save|bonus|penalty|Strike|condition|immune)\b/i;

// Links in PF2e's text: conditions, spells, Spell Effects and any compendium item.
export const CONDITION_LINK = String.raw`@UUID\[(Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+)\]\{([A-Z][a-z]+)(?: (\d))?\}`;
export const CONDITION_LINK_HYPHENATED = String.raw`@UUID\[(Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+)\]\{([A-Za-z-]+)(?: (\d+))?\}`;
export const CONDITION_LINK_HYPHEN_NAME = String.raw`@UUID\[(Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+)\]\{([A-Z][a-z-]+)(?: (\d))?\}`;
export const CONDITION_LINK_START = String.raw`@UUID\[Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+\]\{`;
export const CONDITION_LINK_UNVALUED = String.raw`@UUID\[(Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+)\]\{([A-Z][a-z]+)\}`;
export const CONDITION_UUID_START = String.raw`@UUID\[(Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+)\]\{`;
export const CONDITION_ID_LINK = String.raw`@UUID\[Compendium\.pf2e\.conditionitems\.Item\.([A-Za-z0-9]+)\]\{([A-Z][a-z]+)(?: (\d))?\}`;
export const CONDITION_ID_LINK_VALUED = String.raw`@UUID\[Compendium\.pf2e\.conditionitems\.Item\.([A-Za-z0-9]+)\]\{([A-Z][a-z]+) (\d)\}`;
export const PRONE = "@UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}";
export const PETRIFIED_UUID = "Compendium.pf2e.conditionitems.Item.dTwPJuKgBQCMxixg";
export const SPELL = String.raw`@UUID\[(Compendium\.pf2e\.spells-srd\.Item\.[A-Za-z0-9]+)\]\{([^}]+)\}`;
export const SPELL_EFFECT_LINK = /^@UUID\[Compendium\.pf2e\.spell-effects\.Item\.([^\]]+)\]\{(Spell Effect: [^}]+)\}$/;
export const SPELL_EFFECT_LINK_ANY = /^@UUID\[Compendium\.pf2e\.spell-effects\.[^\]]+\]\{[^}]+\}$/;
export const SPELL_EFFECT_LINK_INLINE = /@UUID\[Compendium\.pf2e\.spell-effects\.Item\.[^\]]+\]\{[^}]+\}/;
export const SPELL_EFFECT_LINK_LABEL = /^@UUID\[Compendium\.pf2e\.spell-effects\.Item\.([^\]]+)\]\{([^}]+)\}$/;
export const ITEM_LINK = /^@UUID\[(Compendium\.[A-Za-z0-9_.-]+\.Item\.([A-Za-z0-9]{16}))\]\{([^}]+)\}$/;
export const ITEM_LINK_PLAIN = /^@UUID\[Compendium\.[A-Za-z0-9_.-]+\.Item\.[A-Za-z0-9]{16}\]\{[^}]+\}$/;

// A condition, optionally valued, optionally with a duration: "Dazzled for 1 round", "@UUID[…]{Stupefied 1}".
export const CONDITION = String.raw`(?:@@\d+@@|[A-Za-z]+(?: \d+)?)(?: for \d+ (?:round|minute)s?)?`;

// Dice ("1d10+4") or a flat amount ("6"); dice of a damage type.
export const DICE_OR_FLAT = String.raw`(\d+d\d+(?:\+\d+)?|\d+)`;
export const DICE_DAMAGE = String.raw`(\d+d\d+) ([a-z]+) damage`;
export const SAVE_NAME_GROUP = String.raw`(Fortitude|Reflex|Will)`;

// Whole sentences the readers match.
export const ATTEMPTS_SAVE = /^The target attempts an? (Fortitude|Reflex|Will) save\.$/;
export const MUST_ATTEMPT_SAVE = /^The target must attempt an? (Fortitude|Reflex|Will) save\.$/;
export const MUST_ATTEMPT_SAVE_LEAD = /^(.+) The target must attempt an? (Fortitude|Reflex|Will) save\.$/;
export const DETERMINES = /^The number of actions you spend when Casting this Spell determines its targets, range, area, and other parameters\.$/;
export const DISMISS_THE = /^You can Dismiss the spell\.$/;
export const DISMISS_THIS = /^You can Dismiss this spell\.$/;
export const DOMAIN = /^<strong>Domain<\/strong> ([a-z]+(?: \([a-z]+\))?)$/;
export const DURATION_ROW = /^As success, but the duration is (\d+) (round|minute|hour)s?\.$/;
export const ENDS = /^The spell then ends\.$/;
export const HAZARD_MOVE = /^A creature that moves on the ground through the area takes (\d+) ([a-z]+) damage for every square of that area it moves into\.$/;
export const HEIGHTENED_DAMAGE_ROW = /^<p>\s*<strong>\s*Heightened \(\+(\d)\)\s*<\/strong>\s*The damage increases by (\d+)d(\d+)\.\s*<\/p>$/;
export const HEIGHTENED_DAMAGE_STEP = /^Heightened \(\+(\d)\) The damage increases by (\d)d(\d+)\.$/;
export const HEIGHTENED_DAMAGE_STEP_ONE = /^Heightened \(\+1\) The damage increases by (\d+)d(\d+)\.$/;
export const HEIGHTENED_TYPED_DAMAGE_STEP = /^Heightened \(\+(\d)\) The ([a-z]+) damage increases by (\d+)d(\d+)\.$/;
export const TOUCH = /^The spell has a range of touch\.$/;
export const DEGREE_LABEL = /^PF2E\.Check\.Result\.Degree\.Check\.(success|failure|criticalFailure)$/;

// Degrees of success: rows by heading, labels both ways, one degree better or worse.
export const DEGREE_LABEL_PAIRS = Object.freeze([["criticalSuccess", "Critical Success"], ["success", "Success"], ["failure", "Failure"], ["criticalFailure", "Critical Failure"]]);
export const HEADINGS = Object.freeze({ criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" });
export const LABELS = Object.freeze({ "Critical Success": "criticalSuccess", Success: "success", Failure: "failure", "Critical Failure": "criticalFailure" });
export const BETTER = Object.freeze({ criticalSuccess: "criticalSuccess", success: "criticalSuccess", failure: "success", criticalFailure: "failure" });
export const WORSE = Object.freeze({ criticalSuccess: "success", success: "failure", failure: "criticalFailure", criticalFailure: "criticalFailure" });

// Word tables.
export const WORD_NUMBERS_1_3 = Object.freeze({ one: 1, two: 2, three: 3 });
export const WORD_NUMBERS_1_5 = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5 });
export const WORD_NUMBERS_1_6 = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });
export const WORD_NUMBERS_2_4 = Object.freeze({ two: 2, three: 3, four: 4 });
export const WORD_NUMBERS_2_5 = Object.freeze({ two: 2, three: 3, four: 4, five: 5 });
export const WORD_NUMBERS_2_6 = Object.freeze({ two: 2, three: 3, four: 4, five: 5, six: 6 });
export const ROUND_WORDS = Object.freeze({ second: 2, third: 3, fourth: 4, fifth: 5 });
export const UNIT = Object.freeze({ round: "rounds", minute: "minutes", hour: "hours" });
export const SIZE_SLUGS = Object.freeze({ Tiny: "tiny", Small: "sm", Medium: "med", Large: "lg", Huge: "huge", Gargantuan: "grg" });
export const SIZE_SLUGS_TO_HUGE = Object.freeze({ Tiny: "tiny", Small: "sm", Medium: "med", Large: "lg", Huge: "huge" });
export const SIZE_SLUGS_TO_LARGE = Object.freeze({ Tiny: "tiny", Small: "sm", Medium: "med", Large: "lg" });
export const SKILLS = Object.freeze(["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery"]);
export const TRADITIONS = Object.freeze(["arcane", "divine", "occult", "primal"]);
export const LEGACY_SCHOOLS = Object.freeze(["abjuration", "conjuration", "divination", "enchantment", "evocation", "necromancy", "transmutation"]);
export const TYPES = new Set(["acid", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "slashing", "sonic", "spirit", "vitality", "void"]);

// Plain text from PF2e's HTML.
export const plain = html => htmlToPlainText(html).replace(/\s+/g, " ").trim();
export const plainOrEmpty = html => htmlToPlainText(String(html ?? "")).replace(/\s+/g, " ").trim();
export const plainApostrophes = html => htmlToPlainText(String(html ?? "")).replace(/\s+/g, " ").trim().replace(/[’]/g, "'");
export const plainUnlinked = html => htmlToPlainText(String(html ?? "")).replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1").replace(/\s+/g, " ").trim();
export const stripTags = html => String(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
export const unlinkText = text => text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1");
export const blocks = adapted => String(adapted.descriptionHTML ?? "").split(/<hr\s*\/?>/);
export const rowOf = (html, heading) => { const row = new RegExp(String.raw`<strong>\s*${heading}\s*</strong>([\s\S]*?)</p>`).exec(html); return row ? row[1].replace(/\s+/g, " ").trim() : null; };
export const rows = list => `<hr />` + ["Critical Success", "Success", "Failure", "Critical Failure"].map((label, index) => `<p><strong>${label}</strong> ${list[index]}</p>`).join("");

// Sentences: split at a sentence end before a capital (or an @ link), trimmed or not.
export const sentenceSplit = text => text.split(/(?<=[.!?])\s+(?=[A-Z@])/).filter(Boolean);
export const sentenceSplitCapital = text => text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
export const sentenceSplitTrimmed = text => text.split(/(?<=[.!?])\s+(?=[A-Z@])/).map(sentence => sentence.trim()).filter(Boolean);
export const trimmedSentences = text => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z@])/).map(sentence => sentence.trim()).filter(Boolean);
export const squashedSentences = text => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z@])/).filter(Boolean);
export const cleanSentences = text => String(text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z@])/).map(sentence => sentence.trim()).filter(Boolean);
export const paragraphSentences = html => html.replace(/<\/?p>/g, " ").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z@])/).filter(Boolean);
export const plainSentences = html => htmlToPlainText(html).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
export const plainSentencesTrimmed = html => htmlToPlainText(html).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z@])/).map(sentence => sentence.trim()).filter(Boolean);

// (Every sentence read: those stated claimed; nothing with a number, a roll, damage or a save left behind.)
export const matchAll = (sentences, patterns) => patterns.map(pattern => sentences.map(sentence => pattern.exec(sentence)).find(Boolean));
export const unread = (sentences, found, allowed = []) => sentences.filter(sentence => !found.some(match => match?.[0] === sentence) && !allowed.some(pattern => pattern.test(sentence)));

// Small helpers.
export const capitalize = name => name[0].toUpperCase() + name.slice(1);
export const slug = text => text.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
export const condition = (uuid, name, value) => `@UUID[${uuid}]{${name}${value ? ` ${value}` : ""}}`;
export const link = c => `@UUID[Compendium.pf2e.conditionitems.Item.${c.id}]{${c.name}${c.value != null ? ` ${c.value}` : ""}}`;
export const condUuidLate = uuid => uuid.replace(/conditionitems\.(?!Item\.)/, "conditionitems.Item.");
export const named = (pattern, name) => new RegExp(pattern.source.replaceAll("\\1", name));
export const minutes = adapted => Number(/^(\d+) minutes?$/.exec(adapted.lifecycle?.duration ?? "")?.[1] ?? NaN);
export const secondsOf = text => durationSeconds(text);
export function unique(values) {
    return [...new Set(values)];
}
export function baseReference(reference) {
    return String(reference ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}
