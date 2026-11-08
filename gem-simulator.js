// Utility function to determine if an operation is successful based on a given chance
function isSuccess(successChance) {
    return Math.random() < successChance;
}

// Calculate the number of shards from arnebia
function calculateNumShards(arnebiaAmount, arnebiaPrice) {
    return arnebiaPrice > 0 ? Math.floor(arnebiaAmount / arnebiaPrice) : 0;
}

let gemPaused = false;
let gemRunning = false;
let gemSoundMode = false;
let usedShardCounter = 0;

const gemPauseButton = document.getElementById('pauseGemEnhance');
const gemStartButton = document.getElementById('startGemEnhance');
const gemTypeElement = document.getElementById('gemType');
const gemServerSelector = document.getElementById('gemServer');
const interactiveGemCheckbox = document.getElementById('interactiveGemSimulation');
const gemSoundContainer = document.getElementById('gemSoundContainer');
const useGemSoundsCheckbox = document.getElementById('useGemSounds');
const gemInventoryContainer = document.getElementById('gemInventoryContainer');
const multipleGemInventoryContainer = document.getElementById('multipleGemInventoryContainer');
const calcByMultiGemsRadio = document.getElementById('calcByMultiGems');

const gemSounds = {
    success: new Audio('sounds/success_gem.wav'),
    fail: new Audio('sounds/failed_gem.wav')
};

function buildShardsPerGemLevel() {
    const shardsPerGemLevel = [0];
    shardsPerGemLevel[1] = 4;
    for (let level = 2; level <= 9; level++) {
        shardsPerGemLevel[level] = shardsPerGemLevel[level - 1] * 3;
    }
    return shardsPerGemLevel;
}

function toggleGemSoundOption() {
    const showSoundOption = interactiveGemCheckbox.checked;
    gemSoundContainer.classList.toggle('hidden', !showSoundOption);
    if (!showSoundOption) {
        useGemSoundsCheckbox.checked = false;
    }
}

interactiveGemCheckbox.addEventListener('change', toggleGemSoundOption);
toggleGemSoundOption();

const gemPriceData = [
    { value: 'ruby', label: 'Ruby', prices: { server1: 2085, server2: 1985 } },
    { value: 'sapphire', label: 'Sapphire', prices: { server1: 20, server2: 20 } },
    { value: 'tiger', label: 'Tiger Eye stone', prices: { server1: 2900, server2: 1890 } },
    { value: 'opal', label: 'Opal', prices: { server1: 2735, server2: 1820 } },
    { value: 'spinel', label: 'Spinel', prices: { server1: 20, server2: 60 } },
    { value: 'aquamarine', label: 'Aquamarine', prices: { server1: 21, server2: 37 } },
    { value: 'garnet', label: 'Garnet', prices: { server1: 4230, server2: 5075 } },
    { value: 'blond', label: 'Blond jade', prices: { server1: 5705, server2: 4390 } },
    { value: 'grape', label: 'Grape stone', prices: { server1: 21, server2: 295 } },
    { value: 'olivine', label: 'Olivine', prices: { server1: 20, server2: 20 } },
    { value: 'topaz', label: 'Topaz', prices: { server1: 205, server2: 66 } },
    { value: 'obsidian', label: 'Obsidian', prices: { server1: 2785, server2: 4220 } },
    { value: 'sunlight', label: 'Sunlight', prices: { server1: 245, server2: 96 } },
    { value: 'moonstone', label: 'Moonstone', prices: { server1: 1880, server2: 2135 } },
    { value: 'turquoise', label: 'Turquoise', prices: { server1: 1570, server2: 2050 } }
];

function populateGemTypes(serverKey) {
    const previousValue = gemTypeElement.value;
    gemTypeElement.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = 'none';
    defaultOption.selected = true;
    defaultOption.textContent = 'No Gem Type';
    gemTypeElement.appendChild(defaultOption);

    gemPriceData.forEach(gem => {
        const option = document.createElement('option');
        option.value = gem.value;
        option.dataset.price = gem.prices[serverKey];
        option.textContent = `${gem.label} (Price: ${gem.prices[serverKey]})`;
        gemTypeElement.appendChild(option);
    });

    if (gemPriceData.some(gem => gem.value === previousValue)) {
        gemTypeElement.value = previousValue;
    }
}

function updateGemStatus(message) {
    const resultField = document.getElementById('gemResultField');
    resultField.value = message;
}

function appendGemLog(message, { soundKey = null, skipTextWhenSound = false } = {}) {
    if (gemSoundMode && soundKey) {
        const sound = gemSounds[soundKey];
        if (sound) {
            sound.currentTime = 0;
            sound.play();
        }
    }
    if (gemSoundMode && skipTextWhenSound) {
        return;
    }
    const log = document.getElementById('gemSimulationLog');
    const entry = document.createElement('div');
    entry.textContent = message;
    log.appendChild(entry);
    updateGemStatus(message);
}

function resetGemLog(showProgress) {
    const log = document.getElementById('gemSimulationLog');
    const progress = document.getElementById('gemProgress');
    log.innerHTML = '';
    progress.value = 0;
    progress.classList.toggle('hidden', !showProgress);
    updateGemStatus('');
}

async function waitForGemResume() {
    while (gemPaused) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function sleepWithGemPause(durationMs) {
    const step = 50;
    let elapsed = 0;
    while (elapsed < durationMs) {
        await waitForGemResume();
        const delay = Math.min(step, durationMs - elapsed);
        await new Promise(resolve => setTimeout(resolve, delay));
        elapsed += delay;
    }
}

// ---------------------------------------------------------------------------
// Gem combining rules, as the game states them (and as players have confirmed):
// - 3 gems of one level combine into 1 gem a level higher, with a 50% chance.
// - From level 2 up, adding 1 shard of the same colour and level adds 20%.
// - On a failure one gem shatters into a shard of its level; the other 2 are kept.
// - The extra shard is used up on every attempt, success or failure...
// - ...except that a Gem Protection Rune (399 diamonds) keeps everything on a
//   failure: no gem shatters and the extra shard is kept too.
// ---------------------------------------------------------------------------
const GEM_BASE_SUCCESS = 0.50;
const EXTRA_SHARD_BONUS = 0.20;
const EXTRA_SHARD_MIN_LEVEL = 2;   // the game only allows an extra shard from level 2 gems up
const PROTECTION_RUNE_USED_ON_SUCCESS = false; // runes are only counted when they save a failure

// One combine attempt of 3 gems of `level`, applied to the gems/shards inventory arrays.
// Returns what happened so callers can log it.
function combineGemsOnce(level, gems, shards, useExtraShard, isProtected) {
    const usesShard = useExtraShard && level >= EXTRA_SHARD_MIN_LEVEL && shards[level] > 0;
    const success = isSuccess(GEM_BASE_SUCCESS + (usesShard ? EXTRA_SHARD_BONUS : 0));
    let runeUsed = false;
    if (success) {
        gems[level] -= 3;
        gems[level + 1] += 1;
        if (usesShard) shards[level]--;
        runeUsed = isProtected && PROTECTION_RUNE_USED_ON_SUCCESS;
    } else if (isProtected) {
        runeUsed = true; // the rune saves all three gems and the extra shard
    } else {
        if (usesShard) shards[level]--;
        gems[level] -= 1;
        shards[level] += 1; // the shattered gem leaves a shard of its level
    }
    return { success, usesShard, runeUsed };
}

// Combine everything upwards, level by level, like a player clearing their bag.
async function combineAllGems(gems, shards, useExtraShard, ProtLevel, interactiveOptions = {}) {
    const { interactive = false, progressBar = null } = interactiveOptions;
    const shardsPerGemLevel = buildShardsPerGemLevel();
    const delay = interactive ? 350 : 0;
    let runesUsed = 0;
    let attempts = 0;

    for (let currentLevel = 1; currentLevel < 9; currentLevel++) {
        while (gems[currentLevel] >= 3) {
            const isProtected = currentLevel >= ProtLevel;
            attempts++;
            usedShardCounter += shardsPerGemLevel[currentLevel] * 3;

            if (interactive) {
                await waitForGemResume();
            }
            const result = combineGemsOnce(currentLevel, gems, shards, useExtraShard, isProtected);
            if (result.runeUsed) runesUsed++;

            if (interactive) {
                const extras = [];
                if (result.usesShard) extras.push('an extra shard');
                if (isProtected) extras.push('a protection rune');
                const withText = extras.length ? ` with ${extras.join(' and ')}` : '';
                appendGemLog(`Attempt ${attempts}: combining 3 Level ${currentLevel} gems${withText}.`, { skipTextWhenSound: true });
                if (result.success) {
                    appendGemLog(`Success! Created a Level ${currentLevel + 1} gem.`, { soundKey: 'success', skipTextWhenSound: true });
                } else if (isProtected) {
                    appendGemLog(`Failed, but the protection rune kept all your gems${result.usesShard ? ' and the extra shard' : ''}.`, { soundKey: 'fail', skipTextWhenSound: true });
                } else {
                    appendGemLog(`Failed! One Level ${currentLevel} gem shattered into a shard${result.usesShard ? ', and the extra shard was used up' : ''}.`, { soundKey: 'fail', skipTextWhenSound: true });
                }
            }

            if (progressBar) {
                progressBar.value = Math.min(progressBar.max, usedShardCounter);
            }
            if (delay) {
                await sleepWithGemPause(delay);
            }
        }
    }
    return runesUsed;
}

// Calculate gem levels from the number of shards
async function calculateGemLevels(numShards, useExtraShard, ProtLevel, arnebiaPrice, interactiveOptions = {}) {
    const gems = new Array(10).fill(0);
    const shards = new Array(10).fill(0);
    usedShardCounter = 0;

    gems[1] = Math.floor(numShards / 4);
    shards[1] = numShards % 4;

    if (interactiveOptions.progressBar) {
        interactiveOptions.progressBar.max = Math.max(numShards, 1);
        interactiveOptions.progressBar.value = 0;
    }

    const runesUsed = await combineAllGems(gems, shards, useExtraShard, ProtLevel, interactiveOptions);
    const leftoverShards = shards.reduce((a, b) => a + b, 0);
    const shardsUsed = numShards - leftoverShards;

    return {
        shardsUsed,
        totalGemCreationCost: shardsUsed * arnebiaPrice,
        gemLevels: gems,
        leftoverShards,
        leftoverShardsByLevel: shards,
        runesUsed
    };
}

// Calculate gem upgrades starting from multiple gem levels instead of shards
async function calculateFromMultipleGems(
    gemEntries,
    useExtraShard,
    ProtLevel,
    arnebiaPrice,
    interactiveOptions = {}
) {
    const gems = new Array(10).fill(0);
    const shards = new Array(10).fill(0);
    const shardsPerGemLevel = buildShardsPerGemLevel();
    usedShardCounter = 0;

    gemEntries.forEach(({ level, count }) => {
        const normalizedLevel = Math.max(1, Math.min(9, parseInt(level, 10)));
        const normalizedCount = Math.max(0, parseInt(count, 10) || 0);
        gems[normalizedLevel] += normalizedCount;
    });

    const totalStartingShards = gems.reduce((total, count, level) => {
        return total + (count * (shardsPerGemLevel[level] || 0));
    }, 0);

    if (interactiveOptions.progressBar) {
        interactiveOptions.progressBar.max = Math.max(totalStartingShards, 1);
        interactiveOptions.progressBar.value = 0;
    }

    const runesUsed = await combineAllGems(gems, shards, useExtraShard, ProtLevel, interactiveOptions);
    const leftoverShards = shards.reduce((a, b) => a + b, 0);
    const shardsUsed = Math.max(0, totalStartingShards - leftoverShards);

    return {
        shardsUsed,
        totalGemCreationCost: shardsUsed * arnebiaPrice,
        gemLevels: gems,
        leftoverShards,
        leftoverShardsByLevel: shards,
        runesUsed
    };
}

// How many shards does it take to make ONE gem of targetGemLevel?
// Simulates the real process: buy level 1 shards, make gems from 4 shards, combine
// 3 gems at a time, keep the shards that failures leave behind (and turn 4 of them
// back into a gem of their level, which never fails). One run is pure luck, so this
// runs many times and reports the average, plus the luckiest and unluckiest run.
function simulateShardsForOneGem(targetGemLevel, useExtraShard) {
    const gems = new Array(11).fill(0);
    const shards = new Array(11).fill(0);
    let bought = 0;

    // Make sure we hold at least `count` gems of `level`.
    function ensureGems(level, count) {
        while (gems[level] < count) {
            if (shards[level] >= 4) {
                shards[level] -= 4;
                gems[level] += 1;
            } else if (level === 1) {
                const needed = 4 - shards[1]; // buy just enough for one more gem
                bought += needed;
                shards[1] += needed;
            } else {
                ensureGems(level - 1, 3);
                combineGemsOnce(level - 1, gems, shards, useExtraShard, false);
            }
        }
    }

    ensureGems(targetGemLevel, 1);
    return bought;
}

// Fewer runs for the highest levels, so the page never freezes for long (each level
// up is about 4 times more work). The result text always says how many runs were used.
const TARGET_RUNS_BY_LEVEL = [0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 300, 100];

function calculateTargetGemLevel(targetGemLevel, useExtraShard, runs = TARGET_RUNS_BY_LEVEL[targetGemLevel] || 200) {
    let total = 0;
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < runs; i++) {
        const bought = simulateShardsForOneGem(targetGemLevel, useExtraShard);
        total += bought;
        min = Math.min(min, bought);
        max = Math.max(max, bought);
    }
    return { average: Math.round(total / runs), min, max, runs };
}

// Event listeners for UI controls
populateGemTypes(gemServerSelector.value);

gemServerSelector.addEventListener('change', function() {
    populateGemTypes(gemServerSelector.value);
});

document.getElementById('calcByLevel').addEventListener('change', function() {
    document.getElementById('targetGemLevelContainer').classList.remove('hidden');
    document.getElementById('numShardsContainer').classList.add('hidden');
    document.getElementById('arnebiaContainer').classList.add('hidden');
    document.getElementById('ProtLevel').setAttribute('disabled', true);
    multipleGemInventoryContainer.classList.add('hidden');
});

document.getElementById('calcByShards').addEventListener('change', function() {
    document.getElementById('targetGemLevelContainer').classList.add('hidden');
    document.getElementById('numShardsContainer').classList.remove('hidden');
    document.getElementById('arnebiaContainer').classList.add('hidden');
    document.getElementById('ProtLevel').removeAttribute('disabled');
    multipleGemInventoryContainer.classList.add('hidden');
});

document.getElementById('calcByArnebia').addEventListener('change', function() {
    document.getElementById('targetGemLevelContainer').classList.add('hidden');
    document.getElementById('numShardsContainer').classList.add('hidden');
    document.getElementById('arnebiaContainer').classList.remove('hidden');
    document.getElementById('ProtLevel').removeAttribute('disabled');
    multipleGemInventoryContainer.classList.add('hidden');
});

// NEW aggregator radio
calcByMultiGemsRadio.addEventListener('change', function() {
    document.getElementById('targetGemLevelContainer').classList.add('hidden');
    document.getElementById('numShardsContainer').classList.add('hidden');
    document.getElementById('arnebiaContainer').classList.add('hidden');
    if (gemInventoryContainer) {
        gemInventoryContainer.classList.add('hidden');
    }
    multipleGemInventoryContainer.classList.remove('hidden');
    document.getElementById('ProtLevel').removeAttribute('disabled');
});

// Main function to handle gem enhancement process
gemPauseButton.addEventListener('click', () => {
    if (!gemRunning) {
        return;
    }
    gemPaused = !gemPaused;
    gemPauseButton.textContent = gemPaused ? 'Resume simulation' : 'Pause simulation';
    updateGemStatus(gemPaused ? 'Gem simulation paused.' : 'Gem simulation resumed.');
});

gemStartButton.addEventListener('click', async function() {
    const gemTypeName = gemTypeElement.options[gemTypeElement.selectedIndex].text;
    const calcByLevel = document.getElementById('calcByLevel').checked;
    const calcByShards = document.getElementById('calcByShards').checked;
    const calcByArnebia = document.getElementById('calcByArnebia').checked;
    const calcByMultiGems = calcByMultiGemsRadio.checked;
    const useExtraShard = document.getElementById('useExtraShard').checked;
    const interactiveGemSimulation = interactiveGemCheckbox.checked;
    gemSoundMode = interactiveGemSimulation && useGemSoundsCheckbox.checked;
    const gemProgress = document.getElementById('gemProgress');
    resetGemLog(interactiveGemSimulation);

    const ProtLevel = document.getElementById('ProtLevel').value === 'none' ? 100 : parseInt(document.getElementById('ProtLevel').value);
    let resultMessage = '';
    const selectedGemType = gemTypeElement.value;
    const arnebiaPrice = selectedGemType === 'none' ? 0 : parseInt(gemTypeElement.selectedOptions[0].dataset.price);

    if (gemTypeElement.value === 'none') {
        alert("Please select a valid gem type.");
        return;
    }

    if (gemRunning) {
        appendGemLog('A gem simulation is already running. Please wait or pause it first.');
        return;
    }

    else if (calcByMultiGems) {
        // We'll handle this in gem-aggregator.js (see that file).
        // The aggregator code will build an array and call "calculateFromMultipleGems()" internally.
        // We'll leave resultMessage blank here. The aggregator will fill it.
        // But let's return so we don't overwrite aggregator results:
        return;
    }

    let numShards = 0;
    if (calcByArnebia) {
        const arnebiaAmount = parseInt(document.getElementById('arnebiaAmount').value);
        if (isNaN(arnebiaAmount) || arnebiaAmount <= 0) {
            alert("Please enter a valid amount of arnebia greater than 0.");
            return;
        }
        numShards = calculateNumShards(arnebiaAmount, arnebiaPrice);
    } else if (calcByShards || !calcByLevel) {
        numShards = parseInt(document.getElementById('numShards').value);
        if (isNaN(numShards) || numShards <= 0) {
            alert("Please enter a valid number of shards greater than 0.");
            return;
        }
    }

    gemPaused = false;
    gemRunning = true;
    gemStartButton.disabled = true;
    gemPauseButton.disabled = !interactiveGemSimulation;
    gemPauseButton.textContent = 'Pause simulation';
    if (interactiveGemSimulation) {
        updateGemStatus('Starting interactive gem simulation...');
    }

    if (calcByLevel) {
        const targetGemLevel = parseInt(document.getElementById('targetGemLevel').value);
        if (isNaN(targetGemLevel) || targetGemLevel <= 0 || targetGemLevel > 9) {
            alert("Please enter a valid target gem level between 1 and 9.");
            gemRunning = false;
            gemPaused = false;
            gemStartButton.disabled = false;
            gemPauseButton.disabled = true;
            return;
        }
        const target = calculateTargetGemLevel(targetGemLevel, useExtraShard);
        const gemLabel = gemTypeName.replace(/\s*\(Price:.*\)$/, '');
        resultMessage = `To create one Level ${targetGemLevel} ${gemLabel}, you need about ${target.average} shards on average`;
        if (arnebiaPrice > 0) {
            resultMessage += `, which costs about ${(target.average * arnebiaPrice).toLocaleString('en-US')} arnebia`;
        }
        resultMessage += `. That is the average of ${target.runs} simulated tries: the luckiest needed ${target.min} shards and the unluckiest ${target.max}.`;
        if (interactiveGemSimulation) {
            appendGemLog('Interactive simulation is only available when simulating shard usage.');
        }
    } else {
        const resultData = await calculateGemLevels(numShards, useExtraShard, ProtLevel, arnebiaPrice, {
            interactive: interactiveGemSimulation,
            progressBar: gemProgress
        });
        resultMessage = `You used ${resultData.shardsUsed} shards to create `;
        for (let level in resultData.gemLevels) {
            if (resultData.gemLevels[level] > 0) {
                resultMessage += `Level ${level}: ${resultData.gemLevels[level]}, `;
            }
        }
        resultMessage = resultMessage.slice(0, -2); // Remove the trailing comma and space
        resultMessage += `. You have ${resultData.leftoverShards} total leftover shards.`;
        resultMessage += " Leftover shards by level: ";
        resultData.leftoverShardsByLevel.forEach((shards, index) => {
            if (index > 0 && shards > 0) {  // Ensure you only display levels with non-zero leftovers
                resultMessage += `Level ${index}: ${shards}, `;
            }
        });
        resultMessage = resultMessage.slice(0, -2);
        if (arnebiaPrice > 0) {
            const totalArnebiaCost = numShards * arnebiaPrice;
            resultMessage += ` The total arnebia cost is ${totalArnebiaCost}.`;
        }
        resultMessage += ` Runes used: ${resultData.runesUsed}`;
    }

    // Display the result
    updateGemStatus(resultMessage);
    gemRunning = false;
    gemPaused = false;
    gemStartButton.disabled = false;
    gemPauseButton.disabled = true;
    gemPauseButton.textContent = 'Pause simulation';
});
