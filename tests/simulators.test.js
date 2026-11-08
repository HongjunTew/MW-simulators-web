// Tests for the simulator math. Run with:  node --test tests/
// Loads the real browser scripts into a sandbox with a tiny fake page, then calls their functions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeElement() {
    return {
        value: '', checked: false, disabled: false, textContent: '', innerHTML: '', max: 1,
        dataset: {}, options: [{ text: '' }], selectedIndex: 0, selectedOptions: [{ dataset: {} }],
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, appendChild() {}, removeChild() {}, add() {},
        setAttribute() {}, removeAttribute() {}, querySelectorAll() { return []; }
    };
}

function loadSimulators() {
    const elements = {};
    const document = {
        getElementById: id => (elements[id] = elements[id] || fakeElement()),
        querySelector: () => fakeElement(),
        createElement: () => fakeElement()
    };
    const context = vm.createContext({ document, Audio: function () { return { play() {} }; }, setTimeout, console, alert() {} });
    for (const file of ['equipment-simulator.js', 'gem-simulator.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    return context;
}

// Replace Math.random inside the sandbox: a fixed value, or a seeded generator.
function setRandom(ctx, valueOrSeed, seeded = false) {
    ctx.__r = valueOrSeed;
    vm.runInContext(seeded
        ? 'Math.random = (() => { let s = __r >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();'
        : 'Math.random = () => __r;', ctx);
}

const empty = () => new Array(11).fill(0);

test('an extra shard is never used on level 1 gems (the game allows it from level 2)', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 0.6); // fails at 50%, would succeed at 70%
    const gems = empty(); const shards = empty();
    gems[1] = 3; shards[1] = 2;
    const r = ctx.combineGemsOnce(1, gems, shards, true, false);
    assert.strictEqual(r.usesShard, false);
    assert.strictEqual(r.success, false);
});

test('from level 2 the extra shard adds 20% (50% becomes 70%)', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 0.6);
    const gems = empty(); const shards = empty();
    gems[2] = 3; shards[2] = 1;
    const r = ctx.combineGemsOnce(2, gems, shards, true, false);
    assert.strictEqual(r.usesShard, true);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual([gems[2], gems[3], shards[2]], [0, 1, 0]);
});

test('a failure without a rune uses up the extra shard and shatters one gem into a shard', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 0.99);
    const gems = empty(); const shards = empty();
    gems[2] = 3; shards[2] = 1;
    const r = ctx.combineGemsOnce(2, gems, shards, true, false);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.runeUsed, false);
    // extra shard gone (-1), shattered gem became a shard (+1); two gems kept
    assert.deepStrictEqual([gems[2], shards[2]], [2, 1]);
});

test('a protection rune keeps all gems and the extra shard on a failure', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 0.99);
    const gems = empty(); const shards = empty();
    gems[3] = 3; shards[3] = 1;
    const r = ctx.combineGemsOnce(3, gems, shards, true, true);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.runeUsed, true);
    assert.deepStrictEqual([gems[3], shards[3]], [3, 1]);
});

test('shard mode: shards are never created or lost, only moved', async () => {
    const ctx = loadSimulators();
    setRandom(ctx, 12345, true);
    const res = await ctx.calculateGemLevels(400, true, 100, 10, {});
    const shardValue = [0, 4, 12, 36, 108, 324, 972, 2916, 8748, 26244];
    const gemValue = res.gemLevels.reduce((t, n, lvl) => t + n * (shardValue[lvl] || 0), 0);
    const leftoverValue = res.leftoverShardsByLevel.reduce((t, n, lvl) => t + n * (lvl ? shardValue[lvl] / 4 : 0), 0);
    // The value can only go down (shattered gems lose value); it can never grow.
    assert.ok(gemValue + leftoverValue <= 400, `value grew: ${gemValue + leftoverValue}`);
    assert.strictEqual(res.shardsUsed, 400 - res.leftoverShards);
});

test('target level: one Level 2 gem takes at least 12 shards, and about 15 on average', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 777, true);
    const r = ctx.calculateTargetGemLevel(2, false, 2000);
    assert.ok(r.min >= 12, `min ${r.min}`);
    assert.ok(r.average >= 13 && r.average <= 17, `average ${r.average}`);
});

test('target level: the extra shard makes high gems cheaper', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 4242, true);
    const without = ctx.calculateTargetGemLevel(5, false, 500).average;
    setRandom(ctx, 4242, true);
    const withShard = ctx.calculateTargetGemLevel(5, true, 500).average;
    assert.ok(withShard < without, `with ${withShard}, without ${without}`);
});

test('target level 9 finishes quickly enough not to freeze the page', () => {
    const ctx = loadSimulators();
    setRandom(ctx, 2024, true);
    for (const useExtraShard of [false, true]) {
        const start = Date.now();
        const r = ctx.calculateTargetGemLevel(9, useExtraShard); // default run count
        const ms = Date.now() - start;
        assert.ok(ms < 1000, `level 9 (extra shard ${useExtraShard}) took ${ms} ms`);
        assert.ok(r.average > 100000, `average ${r.average}`);
    }
});

const equipmentBase = {
    equipmentLevelIndex: 4, numSimulations: 300,
    boostRune: false, boostRuneMinLevel: Number.MAX_SAFE_INTEGER,
    protectRune: false, protectRuneMinLevel: Number.MAX_SAFE_INTEGER
};

test('equipment: a protect rune from level 2 always reaches the target and never drops', async () => {
    const ctx = loadSimulators();
    setRandom(ctx, 99, true);
    const r = await ctx.runEquipmentSimulations({ ...equipmentBase, currentEnhancement: 2, targetEnhancement: 11, protectRune: true, protectRuneMinLevel: 2 });
    assert.strictEqual(r.lastEnhancementLevel, 11);
    // with protection every level is climbed exactly once per run
    assert.deepStrictEqual(Array.from(r.perLevel, p => p.level), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('equipment: rune counts use the runes-per-try for the equipment level', async () => {
    const ctx = loadSimulators();
    setRandom(ctx, 5, true);
    const r = await ctx.runEquipmentSimulations({ ...equipmentBase, numSimulations: 1, currentEnhancement: 2, targetEnhancement: 6, boostRune: true, boostRuneMinLevel: 2 });
    // level 70 gear (index 4) takes 11 runes per try, the same count the game shows
    assert.strictEqual(r.totalBoostRunesUsed, r.totalAttempts * 11);
});

test('equipment: dropping below the starting level keeps the per-level numbers sane', async () => {
    const ctx = loadSimulators();
    setRandom(ctx, 31337, true);
    const r = await ctx.runEquipmentSimulations({ ...equipmentBase, currentEnhancement: 8, targetEnhancement: 10 });
    for (const { level, averageTries } of r.perLevel) {
        assert.ok(level >= 3 && level <= 10, `level ${level}`);
        assert.ok(Number.isFinite(averageTries) && averageTries >= 1, `tries ${averageTries}`);
    }
    assert.ok(r.averageTriesPerLevelUp >= 1);
    assert.ok(r.averageTriesPerLevelUp <= r.totalAttempts);
});
