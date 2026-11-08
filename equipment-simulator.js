const levelLabels = ["1 - Normal", "2 - Normal", "3 - Normal", "4 - Normal", "5 - Refined", "6 - Refined", "7 - Refined", "8 - Great", "9 - Great", "10 - Epic", "11 - Heavenly", "12 - Godbless"];
const successRates = [100, 100, 90, 75, 60, 45, 30, 20, 15, 10, 5, 1];
const enhancementGuarantees = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const equipmentLevels = [15, 30, 45, 60, 70, 80, 90, 100];

function populateSelectOptions(selectId, options, startIndex = 1) {
    const select = document.getElementById(selectId);
    options.forEach((option, index) => {
        const optionElement = document.createElement("option");
        optionElement.value = startIndex + index;
        optionElement.text = option;
        select.add(optionElement);
    });
}

populateSelectOptions("currentEnhancement", levelLabels);
populateSelectOptions("equipmentLevel", equipmentLevels.map(level => `Level ${level}`));
populateSelectOptions("targetEnhancement", levelLabels.slice(1), 2); // Start from level 2
populateSelectOptions("boostRuneMinLevel", levelLabels.slice(1), 2); // Start from level 2
populateSelectOptions("protectRuneMinLevel", levelLabels.slice(1), 2); // Start from level 2

function toggleRuneMinLevelContainer(checkboxId, containerId) {
    const checkbox = document.getElementById(checkboxId);
    const container = document.getElementById(containerId);
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    });
}

toggleRuneMinLevelContainer('boostRune', 'boostRuneMinLevelContainer');
toggleRuneMinLevelContainer('protectRune', 'protectRuneMinLevelContainer');
toggleRuneMinLevelContainer('runMultipleSimulations', 'numSimulationsContainer');

let equipmentPaused = false;
let equipmentRunning = false;
let equipmentSoundMode = false;

const manualEnhanceCheckbox = document.getElementById('manualEnhance');
const targetEnhancementContainer = document.getElementById('targetEnhancementContainer');
const targetEnhancementSelect = document.getElementById('targetEnhancement');
const runMultipleSimulationsCheckbox = document.getElementById('runMultipleSimulations');
const numSimulationsContainer = document.getElementById('numSimulationsContainer');
const currentEnhancementSelect = document.getElementById('currentEnhancement');

const equipmentPauseButton = document.getElementById('pauseEnhance');
const equipmentStartButton = document.getElementById('startEnhance');
const interactiveEnhancementCheckbox = document.getElementById('interactiveEnhancement');
const equipmentSoundContainer = document.getElementById('equipmentSoundContainer');
const useEquipmentSoundsCheckbox = document.getElementById('useEquipmentSounds');

const equipmentSounds = {
    success: new Audio('sounds/success_enhance.wav'),
    fail: new Audio('sounds/failed_equipment.wav')
};

function toggleEquipmentSoundOption() {
    const showSoundOption = interactiveEnhancementCheckbox.checked;
    equipmentSoundContainer.classList.toggle('hidden', !showSoundOption);
    if (!showSoundOption) {
        useEquipmentSoundsCheckbox.checked = false;
    }
}

interactiveEnhancementCheckbox.addEventListener('change', toggleEquipmentSoundOption);
toggleEquipmentSoundOption();

function enforceTargetAboveCurrent() {
    if (manualEnhanceCheckbox.checked) {
        return;
    }
    const currentEnhancement = parseInt(currentEnhancementSelect.value);
    if (parseInt(targetEnhancementSelect.value) <= currentEnhancement) {
        targetEnhancementSelect.value = currentEnhancement + 1;
    }
}

function toggleManualEnhance() {
    const manualMode = manualEnhanceCheckbox.checked;
    targetEnhancementContainer.classList.toggle('hidden', manualMode);
    targetEnhancementSelect.disabled = manualMode;
    runMultipleSimulationsCheckbox.disabled = manualMode;
    if (manualMode) {
        runMultipleSimulationsCheckbox.checked = false;
        numSimulationsContainer.classList.add('hidden');
    }
    enforceTargetAboveCurrent();
}

manualEnhanceCheckbox.addEventListener('change', toggleManualEnhance);
currentEnhancementSelect.addEventListener('change', enforceTargetAboveCurrent);
toggleManualEnhance();

function updateEquipmentStatus(message) {
    const resultField = document.getElementById('resultField');
    resultField.value = message;
}

function appendEquipmentLog(message, { soundKey = null, skipTextWhenSound = false } = {}) {
    if (equipmentSoundMode && soundKey) {
        const sound = equipmentSounds[soundKey];
        if (sound) {
            sound.currentTime = 0;
            sound.play();
        }
    }
    if (equipmentSoundMode && skipTextWhenSound) {
        return;
    }
    const equipmentLog = document.getElementById('equipmentSimulationLog');
    const entry = document.createElement('div');
    entry.textContent = message;
    equipmentLog.appendChild(entry);
    updateEquipmentStatus(message);
}

function resetEquipmentLog(showProgress) {
    const equipmentLog = document.getElementById('equipmentSimulationLog');
    const equipmentProgress = document.getElementById('equipmentProgress');
    equipmentLog.innerHTML = '';
    equipmentProgress.value = 0;
    equipmentProgress.classList.toggle('hidden', !showProgress);
    updateEquipmentStatus('');
}

async function waitForEquipmentResume() {
    while (equipmentPaused) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function sleepWithEquipmentPause(durationMs) {
    const step = 50;
    let elapsed = 0;
    while (elapsed < durationMs) {
        await waitForEquipmentResume();
        const delay = Math.min(step, durationMs - elapsed);
        await new Promise(resolve => setTimeout(resolve, delay));
        elapsed += delay;
    }
}

const DIAMONDS_PER_BOOST_RUNE = 5;
const DIAMONDS_PER_PROTECT_RUNE = 12;
const SHARDS_PER_CRYSTAL = [2, 4, 10, 20, 40, 70, 120, 200];      // by equipment level
const RUNES_PER_EQUIPMENT_LEVEL = [1, 2, 4, 7, 11, 15, 21, 25];   // runes per try, by equipment level

// Runs the enhancement simulation numSimulations times and returns the totals.
// A failure without a protect rune drops one level; with one, the level is kept.
// "Tries" for a level count every attempt since the last level change, which is what the
// guarantee counter tracks, and are recorded under the level that was reached.
async function runEquipmentSimulations(opts) {
    const {
        currentEnhancement, targetEnhancement, equipmentLevelIndex, numSimulations,
        boostRune, boostRuneMinLevel, protectRune, protectRuneMinLevel,
        interactive = false, progressBar = null
    } = opts;
    const runeMultiplier = RUNES_PER_EQUIPMENT_LEVEL[equipmentLevelIndex];
    const triesByLevel = new Array(levelLabels.length + 2).fill(0);
    const levelUpsByLevel = new Array(levelLabels.length + 2).fill(0);
    let totalAttempts = 0;
    let totalBoostRunesUsed = 0;
    let totalProtectRunesUsed = 0;
    let minAttempts = Number.MAX_SAFE_INTEGER;
    let countOfLowestAttempts = 0;
    let lastEnhancementLevel = currentEnhancement;
    const delay = interactive ? 400 : 0;

    for (let sim = 0; sim < numSimulations; sim++) {
        let enhancementLevel = currentEnhancement;
        let attempts = 0;
        let enhanceGar = 0;

        while (enhancementLevel < targetEnhancement) {
            attempts++;
            enhanceGar++;
            const applyBoostRune = boostRune && enhancementLevel >= boostRuneMinLevel;
            const applyProtectRune = protectRune && enhancementLevel >= protectRuneMinLevel;
            const successRate = successRates[enhancementLevel - 1] + (applyBoostRune ? 5 : 0);
            const guarantee = enhancementGuarantees[enhancementLevel - 1];
            const enhanceSuccess = enhanceGar >= guarantee || Math.random() * 100 < successRate;
            if (interactive) {
                await waitForEquipmentResume();
                appendEquipmentLog(`Attempt ${attempts}: L${enhancementLevel} -> ${enhancementLevel + 1} (${enhanceGar}/${guarantee} guarantee).`, { skipTextWhenSound: true });
            }

            if (enhanceSuccess) {
                enhancementLevel++;
                triesByLevel[enhancementLevel] += enhanceGar;
                levelUpsByLevel[enhancementLevel]++;
                enhanceGar = 0; // the guarantee counter restarts at every new level
                if (interactive) {
                    appendEquipmentLog(`Success! Current level: ${enhancementLevel}.`, { soundKey: 'success', skipTextWhenSound: true });
                    if (progressBar) progressBar.value = Math.max(0, enhancementLevel - currentEnhancement);
                }
            } else if (applyProtectRune) {
                if (interactive) {
                    appendEquipmentLog(`Failed, but the protect rune kept you at level ${enhancementLevel}.`, { soundKey: 'fail', skipTextWhenSound: true });
                }
            } else {
                enhancementLevel = Math.max(enhancementLevel - 1, 2);
                if (interactive) {
                    appendEquipmentLog(`Failed! Dropped to ${enhancementLevel}.`, { soundKey: 'fail', skipTextWhenSound: true });
                    if (progressBar) progressBar.value = Math.max(0, enhancementLevel - currentEnhancement);
                }
            }

            if (applyBoostRune) totalBoostRunesUsed += runeMultiplier;
            if (applyProtectRune) totalProtectRunesUsed += runeMultiplier;

            if (delay) {
                await sleepWithEquipmentPause(delay);
            }
        }

        lastEnhancementLevel = enhancementLevel;
        if (attempts === minAttempts) {
            countOfLowestAttempts++;
        } else if (attempts < minAttempts) {
            minAttempts = attempts;
            countOfLowestAttempts = 1;
        }
        totalAttempts += attempts;
    }

    const perLevel = [];
    let allTries = 0;
    let allLevelUps = 0;
    for (let level = 0; level < triesByLevel.length; level++) {
        if (levelUpsByLevel[level] > 0) {
            perLevel.push({ level, averageTries: triesByLevel[level] / levelUpsByLevel[level] });
            allTries += triesByLevel[level];
            allLevelUps += levelUpsByLevel[level];
        }
    }

    return {
        totalAttempts,
        totalBoostRunesUsed,
        totalProtectRunesUsed,
        minAttempts,
        countOfLowestAttempts,
        lastEnhancementLevel,
        shardsRequired: SHARDS_PER_CRYSTAL[equipmentLevelIndex] * totalAttempts,
        averageTriesPerLevelUp: allLevelUps ? allTries / allLevelUps : 0,
        perLevel
    };
}

equipmentPauseButton.addEventListener('click', () => {
    if (!equipmentRunning) {
        return;
    }
    equipmentPaused = !equipmentPaused;
    equipmentPauseButton.textContent = equipmentPaused ? 'Resume simulation' : 'Pause simulation';
    updateEquipmentStatus(equipmentPaused ? 'Simulation paused.' : 'Simulation resumed.');
});

equipmentStartButton.addEventListener('click', async () => {
    const currentEnhancement = parseInt(currentEnhancementSelect.value);
    const manualEnhance = manualEnhanceCheckbox.checked;
    const targetEnhancement = manualEnhance ? currentEnhancement + 1 : parseInt(targetEnhancementSelect.value);
    const boostRune = document.getElementById('boostRune').checked;
    const protectRune = document.getElementById('protectRune').checked;
    const selectedEquipmentLevelText = document.getElementById('equipmentLevel').options[document.getElementById('equipmentLevel').selectedIndex].text;
    const equipmentLevel = parseInt(selectedEquipmentLevelText.split(' ')[1]);
    const boostRuneMinLevel = boostRune ? parseInt(document.getElementById('boostRuneMinLevel').value) : Number.MAX_SAFE_INTEGER;
    const protectRuneMinLevel = protectRune ? parseInt(document.getElementById('protectRuneMinLevel').value) : Number.MAX_SAFE_INTEGER;
    const interactiveEnhancement = interactiveEnhancementCheckbox.checked;
    equipmentSoundMode = interactiveEnhancement && useEquipmentSoundsCheckbox.checked;

    if (manualEnhance && currentEnhancement >= levelLabels.length) {
        alert('Manual enhancement is not available at the maximum enhancement level.');
        return;
    }

    if (targetEnhancement <= currentEnhancement) {
        alert('Target enhancement level should be higher than the current enhancement level.');
        return;
    }

    if (equipmentRunning) {
        appendEquipmentLog('A simulation is already running. Please wait or pause it first.');
        return;
    }

    const runMultipleSimulations = runMultipleSimulationsCheckbox.checked;
    let numSimulations = runMultipleSimulations ? parseInt(document.getElementById('numSimulations').value) : 1;
    const equipmentProgress = document.getElementById('equipmentProgress');
    const requireInteractiveSingleRun = interactiveEnhancement && numSimulations > 1;
    resetEquipmentLog(interactiveEnhancement);
    equipmentPaused = false;
    equipmentRunning = true;
    equipmentStartButton.disabled = true;
    equipmentPauseButton.disabled = !interactiveEnhancement;
    equipmentPauseButton.textContent = 'Pause simulation';
    if (interactiveEnhancement) {
        updateEquipmentStatus('Starting interactive equipment simulation...');
    }

    if (requireInteractiveSingleRun) {
        numSimulations = 1;
        appendEquipmentLog('Interactive simulation runs a single session; multi-run average disabled.');
    }

    if (interactiveEnhancement) {
        equipmentProgress.max = targetEnhancement - currentEnhancement;
    }

    const equipmentLevelIndex = equipmentLevels.indexOf(equipmentLevel);
    if (equipmentLevelIndex === -1) {
        alert('Invalid equipment level selected.');
        equipmentRunning = false;
        equipmentPaused = false;
        equipmentStartButton.disabled = false;
        equipmentPauseButton.disabled = true;
        return;
    }

    const sim = await runEquipmentSimulations({
        currentEnhancement, targetEnhancement, equipmentLevelIndex, numSimulations,
        boostRune, boostRuneMinLevel, protectRune, protectRuneMinLevel,
        interactive: interactiveEnhancement, progressBar: equipmentProgress
    });
    const totalAttempts = sim.totalAttempts;
    const totalBoostRunesUsed = sim.totalBoostRunesUsed;
    const totalProtectRunesUsed = sim.totalProtectRunesUsed;
    const minAttempts = sim.minAttempts;
    const lastEnhancementLevel = sim.lastEnhancementLevel;
    const averageGarLevel = sim.averageTriesPerLevelUp;
    const shardsRequired = sim.shardsRequired;
    const diamondsPerDollar = 1000 / 19.99;
    // Every diamond figure comes from the rune counts, so single and multiple runs always agree.
    const protectRunesDiamondCost = totalProtectRunesUsed * DIAMONDS_PER_PROTECT_RUNE;
    const boostRunesDiamondCost = totalBoostRunesUsed * DIAMONDS_PER_BOOST_RUNE;
    const totalDiamondCost = protectRunesDiamondCost + boostRunesDiamondCost;
    const averageTotalDiamondCost = totalDiamondCost / numSimulations;
    const averageDollarCost = (averageTotalDiamondCost / diamondsPerDollar).toFixed(2);
    const averageProtectRunesDiamondCost = protectRunesDiamondCost / numSimulations;
    const averageBoostRunesDiamondCost = boostRunesDiamondCost / numSimulations;
    const probabilityOfLowestChance = sim.countOfLowestAttempts / numSimulations;

    //let's parse together our results
    let resultMessage = '';
    const averageGarLevelsStr = sim.perLevel
        .map(({ level, averageTries }) => `L${level}: ${averageTries.toFixed(2)}`)
        .join(', ');

    if (runMultipleSimulations && !interactiveEnhancement) {
        const averageAttempts = Math.round(totalAttempts / numSimulations);
        const averageShardsRequired = Math.round(shardsRequired / numSimulations);
        const averageBoostRunesUsed = Math.round(totalBoostRunesUsed / numSimulations);
        const averageProtectRunesUsed = Math.round(totalProtectRunesUsed / numSimulations);
        resultMessage = `On average, it would take you ${averageAttempts} enhancements to go from level ${currentEnhancement} (${levelLabels[currentEnhancement - 1]}) to level ${targetEnhancement} (${levelLabels[targetEnhancement - 1]}).`;
        resultMessage += ` Average Shards required: ${averageShardsRequired}.`;
        resultMessage += ` On average, each level-up took ${averageGarLevel.toFixed(2)} tries.`;
        if (boostRune) {
            resultMessage += ` Average boost rune diamond cost: ${averageBoostRunesDiamondCost.toFixed(2)} diamonds.`;
        }
        if (protectRune) {
            resultMessage += ` Average protect rune diamond cost: ${averageProtectRunesDiamondCost.toFixed(2)} diamonds.`;
        }
        if (boostRune || protectRune) {
            resultMessage += ` Total average diamond cost: ${averageTotalDiamondCost.toFixed(2)} diamonds. This costs around an average of $${averageDollarCost}.`;
        }
        resultMessage += ` Probability of lowest-chance (${minAttempts} enhancements) happening: ${(probabilityOfLowestChance * 100).toFixed(4)}%.`;
    } else {
        resultMessage = `It would take you ${totalAttempts} enhancements to go from level ${currentEnhancement} (${levelLabels[currentEnhancement - 1]}) to level ${targetEnhancement} (${levelLabels[targetEnhancement - 1]}). Shards required: ${shardsRequired}.`;
        resultMessage += ` Tries for each level: ${averageGarLevelsStr}.`;
        if (boostRune) {
            resultMessage += ` Boost Runes used: ${totalBoostRunesUsed}. Boost runes would cost ${boostRunesDiamondCost} diamonds.`;
        }
        if (protectRune) {
            resultMessage += ` Protect Runes used: ${totalProtectRunesUsed}. Protector runes would cost ${protectRunesDiamondCost} diamonds.`;
        }
        if (boostRune || protectRune) {
            resultMessage += ` Total diamond cost: ${totalDiamondCost}. This costs around $${(totalDiamondCost / diamondsPerDollar).toFixed(2)}.`;
        }
    }

    // Display the result message in the result field
    updateEquipmentStatus(resultMessage);
    equipmentRunning = false;
    equipmentPaused = false;
    equipmentStartButton.disabled = false;
    equipmentPauseButton.disabled = true;
    equipmentPauseButton.textContent = 'Pause simulation';

    if (manualEnhance) {
        currentEnhancementSelect.value = lastEnhancementLevel;
        enforceTargetAboveCurrent();
    }
});
