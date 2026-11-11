import test from "node:test";
import assert from "node:assert/strict";

import { noticeFields, noticeHTML, noticeKey, seenRecently, immunityWords, typeWords } from "../src/immunity-notice.js";

test("immunity notice: the GM's words", () => {
    assert.equal(noticeHTML({ target: "Goblin Warrior", blocked: "Frightened 2", why: "immune to fear effects", source: "Demoralize" }), "<p><strong>Immunity</strong>: Goblin Warrior isn't affected by Frightened 2 from Demoralize (immune to fear effects).</p>");
    assert.equal(noticeHTML({ target: "Zombie <b>", blocked: "Sickened 1" }), "<p><strong>Immunity</strong>: Zombie &lt;b&gt; isn't affected by Sickened 1.</p>");
    // (Its source the same as what's blocked: said once.)
    assert.equal(noticeHTML({ target: "Orc", blocked: "Demoralize", source: "demoralize", why: "temporarily immune" }), "<p><strong>Immunity</strong>: Orc isn't affected by Demoralize (temporarily immune).</p>");
    assert.deepEqual(noticeFields({}), { target: "A creature", blocked: "an effect", why: null, source: null });
});

test("immunity notice: the same one twice within moments is sent once", () => {
    const seen = new Map();
    const key = noticeKey({ target: "Orc", blocked: "Frightened 1" });
    assert.equal(seenRecently(seen, key, 1000), false);
    assert.equal(seenRecently(seen, key, 1500), true);
    assert.equal(seenRecently(seen, noticeKey({ target: "Orc", blocked: "Frightened 2" }), 1500), false);
    assert.equal(seenRecently(seen, key, 5000), false);
});

test("immunity notice: which immunity blocks it", () => {
    const immunities = [
        { type: "fire", test: (statements) => statements.has("item:trait:fire") },
        { type: "fear-effects", test: (statements) => statements.has("item:trait:fear") }
    ];
    assert.equal(immunityWords(immunities, new Set(["item:trait:fear", "item:slug:frightened"])), "immune to fear effects");
    assert.equal(immunityWords(immunities, new Set(["item:trait:cold"])), null);
    assert.equal(immunityWords([{ type: "x", label: "Immunity: Death Effects", test: () => true }], new Set()), "immune to death effects");
    assert.equal(typeWords("frightened"), "immune to frightened");
});
