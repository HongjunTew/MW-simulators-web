// gem-aggregator.js

(function(){
    const calcByMultiGemsRadio = document.getElementById('calcByMultiGems');
    const multipleGemInventoryContainer = document.getElementById('multipleGemInventoryContainer');
    const gemTableBody = document.querySelector('#gemTable tbody');
    const addGemRowBtn = document.getElementById('addGemRowBtn');
    const startGemEnhanceBtn = document.getElementById('startGemEnhance');

    // Add a fresh row for entering gem level & count
    function addGemRow() {
        const newRow = document.createElement('tr');

        const levelTd = document.createElement('td');
        const levelInput = document.createElement('input');
        levelInput.type = 'number';
        levelInput.min = '1';
        levelInput.max = '9';
        levelInput.value = '1';
        levelTd.appendChild(levelInput);

        const countTd = document.createElement('td');
        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '1';
        countInput.value = '1';
        countTd.appendChild(countInput);

        const removeTd = document.createElement('td');
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.classList.add('removeRowBtn');
        removeBtn.addEventListener('click', () => {
            gemTableBody.removeChild(newRow);
        });
        removeTd.appendChild(removeBtn);

        newRow.appendChild(levelTd);
        newRow.appendChild(countTd);
        newRow.appendChild(removeTd);

        gemTableBody.appendChild(newRow);
    }

    // If aggregator mode is selected, we show it. If not, hide it.
    calcByMultiGemsRadio.addEventListener('change', () => {
        multipleGemInventoryContainer.classList.remove('hidden');
    });

    // On "Add Another Row" click
    addGemRowBtn.addEventListener('click', () => {
        addGemRow();
    });

    // Add an initial row by default
    addGemRow();

    // Intercept the "Start Gem Enhance" for aggregator mode
    startGemEnhanceBtn.addEventListener('click', async () => {
        // If aggregator mode isn't active, do nothing special (gem-simulator.js will handle it).
        if (!calcByMultiGemsRadio.checked) {
            return;
        }

        if (gemRunning) {
            appendGemLog('A gem simulation is already running. Please wait or pause it first.');
            return;
        }

        // Gather user input from each row
        const rows = gemTableBody.querySelectorAll('tr');
        const gemLevelsArray = [];
        let hasInvalidInput = false;

        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs.length < 2) return;

            const levelVal = parseInt(inputs[0].value);
            const countVal = parseInt(inputs[1].value);

            if (
                isNaN(levelVal) ||
                levelVal < 1 || levelVal > 9 ||
                isNaN(countVal) ||
                countVal <= 0
            ) {
                hasInvalidInput = true;
            } else {
                gemLevelsArray.push({ level: levelVal, count: countVal });
            }
        });

        if (hasInvalidInput || gemLevelsArray.length === 0) {
            alert("Please enter valid gem levels (1-9) and counts (>0).");
            return;
        }

        // We also need to read the other config: ProtLevel, extraShard, gemType, etc.
        const useExtraShard = document.getElementById('useExtraShard').checked;
        const ProtLevelVal = document.getElementById('ProtLevel').value === 'none'
            ? 100
            : parseInt(document.getElementById('ProtLevel').value);

        const gemTypeElement = document.getElementById("gemType");
        const gemTypeName = gemTypeElement.options[gemTypeElement.selectedIndex].text;
        const selectedGemType = gemTypeElement.value;
        const arnebiaPrice = selectedGemType === 'none'
            ? 0
            : parseInt(gemTypeElement.selectedOptions[0].dataset.price);

        if (selectedGemType === 'none') {
            alert("Please select a valid gem type.");
            return;
        }

        const interactiveGemSimulation = document.getElementById('interactiveGemSimulation').checked;
        const gemProgress = document.getElementById('gemProgress');
        const useGemSoundsCheckbox = document.getElementById('useGemSounds');
        const gemPauseButton = document.getElementById('pauseGemEnhance');

        gemSoundMode = interactiveGemSimulation && useGemSoundsCheckbox.checked;
        resetGemLog(interactiveGemSimulation);

        gemPaused = false;
        gemRunning = true;
        startGemEnhanceBtn.disabled = true;
        gemPauseButton.disabled = !interactiveGemSimulation;
        gemPauseButton.textContent = 'Pause simulation';

        let resultData;
        try {
            // Use the function from gem-simulator.js
            resultData = await calculateFromMultipleGems(
                gemLevelsArray,
                useExtraShard,
                ProtLevelVal,
                arnebiaPrice,
                {
                    interactive: interactiveGemSimulation,
                    progressBar: gemProgress,
                    autoCombineShards: document.getElementById('autoCombineShards').checked
                }
            );
        } catch (error) {
            appendGemLog(`Gem aggregation failed: ${error.message || error}`);
            resultData = null;
        }

        if (resultData) {
            // Build a result message
            let message = `Starting with multiple gem levels for ${gemTypeName}, we got: `;

            let anyGems = false;
            for (let lvl = 1; lvl < resultData.gemLevels.length; lvl++) {
                if (resultData.gemLevels[lvl] > 0) {
                    anyGems = true;
                    message += `Level ${lvl}: ${resultData.gemLevels[lvl]}, `;
                }
            }
            if (!anyGems) {
                message += ` no upgraded gems, `;
            }
            message = message.replace(/,\s*$/, '');
            message += `. We have ${resultData.leftoverShards} leftover shards. `;

            if (resultData.leftoverShards > 0) {
                message += "Leftover shards by level: ";
                resultData.leftoverShardsByLevel.forEach((shCount, idx) => {
                    if (idx > 0 && shCount > 0) {
                        message += `L${idx}: ${shCount}, `;
                    }
                });
                message = message.replace(/,\s*$/, '');
            }

            // Runes used
            message += `. Runes used: ${resultData.runesUsed}`;

            // Because we didn't start from shards, totalArnebiaCost is 0
            // but if you want to reflect some cost, you'd handle that logic differently.

            updateGemStatus(message);
        }

        gemRunning = false;
        gemPaused = false;
        startGemEnhanceBtn.disabled = false;
        gemPauseButton.disabled = true;
        gemPauseButton.textContent = 'Pause simulation';
    });
})();
