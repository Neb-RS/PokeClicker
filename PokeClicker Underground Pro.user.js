// ==UserScript==
// @name         PokeClicker Underground Pro
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Reveals Underground treasures and provides optional automatic solving tools.
// @author       Neb
// @license      MIT

// @homepageURL  https://github.com/Neb-RS/PokeClicker
// @supportURL   https://github.com/Neb-RS/PokeClicker/issues

// @match        https://www.pokeclicker.com/
// @icon         https://www.google.com/s2/favicons?domain=pokeclicker.com
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const CONFIG = {
        CHECK_INTERVAL_MS: 300,
        TOOL_IDS: { CHISEL: 0, HAMMER: 1 },
        HAMMER_AREA_RADIUS: 1, // 3x3 grid = radius 1
        CHISEL_DEPTH_DAMAGE: 2,
        HAMMER_DEPTH_DAMAGE: 1,
        DEFAULT_MINE_WIDTH: 25,
        STORAGE_KEY_AUTOMINE: 'neb_pokeclicker_underground_automine',
        STORAGE_KEY_SKIP_DISCOVERY: 'neb_pokeclicker_underground_skip_discovery',
    };

    // ============ UI STATE ============
    let automineButton = null;
    let skipDiscoveryButton = null;

    /**
     * Get automation enabled state from localStorage.
     * @returns {boolean} True if automation is enabled
     */
    function isAutomineEnabled() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY_AUTOMINE);
        return stored !== null ? JSON.parse(stored) : false; // Default to false
    }

    /**
     * Set automation enabled state in localStorage and update button.
     * @param {boolean} enabled - Whether automation should be enabled
     */
    function setAutomineEnabled(enabled) {
        localStorage.setItem(CONFIG.STORAGE_KEY_AUTOMINE, JSON.stringify(enabled));
        updateAutomineButton();
    }

    /**
     * Get skip discovery enabled state from localStorage.
     * @returns {boolean} True if skip discovery is enabled
     */
    function isSkipDiscoveryEnabled() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY_SKIP_DISCOVERY);
        return stored !== null ? JSON.parse(stored) : false; // Default to false
    }

    /**
     * Set skip discovery enabled state in localStorage and update button.
     * @param {boolean} enabled - Whether skip discovery should be enabled
     */
    function setSkipDiscoveryEnabled(enabled) {
        localStorage.setItem(CONFIG.STORAGE_KEY_SKIP_DISCOVERY, JSON.stringify(enabled));
        updateSkipDiscoveryButton();
    }

    /**
     * Update button text and styling to reflect current automation state.
     */
    function updateAutomineButton() {
        if (!automineButton) return;
        const enabled = isAutomineEnabled();
        automineButton.textContent = `AutoMine: ${enabled ? 'ON' : 'OFF'}`;
        automineButton.className = enabled ? 'btn btn-sm btn-success' : 'btn btn-sm btn-danger';
    }

    /**
     * Update button text and styling to reflect current skip discovery state.
     */
    function updateSkipDiscoveryButton() {
        if (!skipDiscoveryButton) return;
        const enabled = isSkipDiscoveryEnabled();
        skipDiscoveryButton.textContent = `Skip Discovery: ${enabled ? 'ON' : 'OFF'}`;
        skipDiscoveryButton.className = enabled ? 'btn btn-sm btn-success' : 'btn btn-sm btn-danger';
    }

    /**
     * Create and inject automation and skip discovery toggle buttons in a new row below the header.
     * Uses MutationObserver for robust DOM detection instead of polling.
     */
    function injectAutomineToggle() {
        // Only inject once
        if (automineButton && skipDiscoveryButton) return;

        const attemptInject = () => {
            const undergroundDisplay = document.getElementById('undergroundDisplay');
            if (!undergroundDisplay) return false;

            const cardHeader = undergroundDisplay.querySelector('.card-header');
            if (!cardHeader) return false;

            // Create the toggle row container
            const toggleRow = document.createElement('div');
            toggleRow.className = 'automine-toggle-row';
            toggleRow.style.gap = '0.5rem';

            // Create the automation toggle button
            automineButton = document.createElement('button');
            automineButton.type = 'button';
            automineButton.className = 'btn btn-sm btn-success';
            automineButton.textContent = 'AutoMine: ON';
            automineButton.style.margin = '0';
            automineButton.addEventListener('click', (e) => {
                e.preventDefault();
                setAutomineEnabled(!isAutomineEnabled());
            });

            // Create the skip discovery toggle button
            skipDiscoveryButton = document.createElement('button');
            skipDiscoveryButton.type = 'button';
            skipDiscoveryButton.className = 'btn btn-sm btn-danger';
            skipDiscoveryButton.textContent = 'Skip Discovery: OFF';
            skipDiscoveryButton.style.margin = '0';
            skipDiscoveryButton.addEventListener('click', (e) => {
                e.preventDefault();
                setSkipDiscoveryEnabled(!isSkipDiscoveryEnabled());
            });

            toggleRow.appendChild(automineButton);
            toggleRow.appendChild(skipDiscoveryButton);

            // Insert after the card header
            cardHeader.parentNode.insertBefore(toggleRow, cardHeader.nextSibling);
            updateAutomineButton();
            updateSkipDiscoveryButton();

            return true;
        };

        // Try immediate injection (in case DOM is already ready)
        if (attemptInject()) return;

        // If not yet available, use MutationObserver to detect DOM changes
        const observer = new MutationObserver(() => {
            if (attemptInject()) {
                observer.disconnect(); // Injection successful, stop observing
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // ============ VISUAL STYLES ============
    const style = document.createElement('style');
    style.innerHTML = `
        .mineSquare { position: relative; }
        .helper-depth-text {
            position: absolute; top: 2px; left: 2px; color: #fff;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
            font-size: 11px; z-index: 100; pointer-events: none; font-family: monospace;
        }
        .helper-treasure-box {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 255, 0, 0.35) !important;
            border: 2px solid #00ff00 !important; box-sizing: border-box;
            z-index: 90; pointer-events: none;
        }
        .automine-toggle-row {
            display: flex; justify-content: center; align-items: center;
            padding: 0.5rem; background-color: rgba(0, 0, 0, 0.05);
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }
    `;
    document.head.appendChild(style);

    // ============ UTILITY FUNCTIONS ============

    /**
     * Safely retrieve tile depth, handling both function and property access patterns.
     * @param {Object} tile - The tile object
     * @returns {number} The depth value, or 0 if retrieval fails
     */
    function getDepth(tile) {
        try {
            return typeof tile.layerDepth === 'function' ? tile.layerDepth() : tile.layerDepth || 0;
        } catch (e) {
            console.warn('Failed to retrieve depth:', e);
            return 0;
        }
    }

    /**
     * Convert grid index to (x, y) coordinates.
     * @param {number} index - Flat grid index
     * @param {number} width - Grid width
     * @returns {Object} {x, y} coordinates
     */
    function indexToCoords(index, width) {
        return { x: index % width, y: Math.floor(index / width) };
    }

    /**
     * Validate mining preconditions.
     * @param {Object} mine - Mine object
     * @param {Object} tools - Tools object
     * @returns {boolean} True if mining can proceed
     */
    function canBeginMining(mine, tools) {
        if (!mine || !tools) return false;
        if (mine.completed || mine.timeUntilDiscovery > 0) return false;
        return true;
    }

    // ============ BATTERY MANAGEMENT ============

    /**
     * Manage battery discharge. Returns true if battery was discharged (caller should skip mining).
     * @returns {boolean} True if battery action was taken
     */
    function manageBattery() {
        if (!App.game.underground.battery) return false;
        const battery = App.game.underground.battery;
        if (battery.charges === battery.maxCharges) {
            battery.discharge();
            return true; // Signal that action was taken
        }
        return false;
    }

    // ============ VISUAL UPDATES ============

    /**
     * Update visual overlays (depth text, treasure highlights).
     * @param {Array} grid - Mine grid
     * @param {number} width - Grid width
     * @param {NodeList} mineSquares - DOM elements for tiles
     */
    function updateVisuals(grid, width, mineSquares) {
        grid.forEach((tile, index) => {
            const currentDepth = getDepth(tile);
            const hasReward = tile.reward !== undefined && tile.reward !== null;
            const domSquare = mineSquares[index];
            if (!domSquare) return;

            // Update depth text
            let depthSpan = domSquare.querySelector('.helper-depth-text');
            if (!depthSpan) {
                depthSpan = document.createElement('span');
                depthSpan.className = 'helper-depth-text';
                domSquare.appendChild(depthSpan);
            }
            depthSpan.textContent = currentDepth;

            // Update treasure box highlight
            let greenBox = domSquare.querySelector('.helper-treasure-box');
            const shouldHighlight = hasReward && currentDepth > 0;
            if (shouldHighlight && !greenBox) {
                greenBox = document.createElement('div');
                greenBox.className = 'helper-treasure-box';
                domSquare.appendChild(greenBox);
            } else if (!shouldHighlight && greenBox) {
                greenBox.remove();
            }
        });
    }

    // ============ MINING LOGIC ============

    /**
     * Find the best hammer spot by checking only positions near treasures.
     * Pre-filters to treasure tiles for efficiency, avoiding wasted empty-space checks.
     * Hammer removes 1 layer from all 9 tiles in its radius.
     * @returns {{x, y, value} | null} Best hammer position or null
     */
    function findBestHammerMove(grid, width, totalHeight, tool) {
        if (!tool || !tool.canUseTool()) return null;

        let bestSpot = null;
        let maxValue = -1;

        // Pre-filter: Collect all positions within 3x3 of any treasure
        const validHammerCenters = new Set();

        for (let i = 0; i < grid.length; i++) {
            const tile = grid[i];
            if (tile.reward && getDepth(tile) > 0) {
                const { x, y } = indexToCoords(i, width);

                // Add this position and all neighbors as potential hammer centers
                for (let dy = -CONFIG.HAMMER_AREA_RADIUS; dy <= CONFIG.HAMMER_AREA_RADIUS; dy++) {
                    for (let dx = -CONFIG.HAMMER_AREA_RADIUS; dx <= CONFIG.HAMMER_AREA_RADIUS; dx++) {
                        const cx = x + dx;
                        const cy = y + dy;

                        if (cx >= 0 && cx < width && cy >= 0 && cy < totalHeight) {
                            validHammerCenters.add(cy * width + cx);
                        }
                    }
                }
            }
        }

        // Evaluate only valid hammer centers (eliminates ~90% of wasted checks)
        validHammerCenters.forEach(centerIndex => {
            let currentValue = 0;
            const { x: centerX, y: centerY } = indexToCoords(centerIndex, width);

            // Scan 3x3 area around center
            for (let dy = -CONFIG.HAMMER_AREA_RADIUS; dy <= CONFIG.HAMMER_AREA_RADIUS; dy++) {
                for (let dx = -CONFIG.HAMMER_AREA_RADIUS; dx <= CONFIG.HAMMER_AREA_RADIUS; dx++) {
                    const tx = centerX + dx;
                    const ty = centerY + dy;

                    // Boundary check
                    if (tx < 0 || tx >= width || ty < 0 || ty >= totalHeight) continue;

                    const tIdx = ty * width + tx;
                    const tile = grid[tIdx];
                    const depth = getDepth(tile);

                    // Count tiles with rewards that can be damaged
                    if (tile.reward && depth > 0) {
                        currentValue += CONFIG.HAMMER_DEPTH_DAMAGE;
                    }
                }
            }

            if (currentValue > maxValue) {
                maxValue = currentValue;
                bestSpot = { x: centerX, y: centerY, value: currentValue };
            }
        });

        return bestSpot;
    }

    /**
     * Find the best chisel move by scanning all tiles.
     * Chisel removes 2 layers from a single tile.
     * @returns {{x, y, value} | null} Best chisel position or null
     */
    function findBestChiselMove(grid, width, tool) {
        if (!tool || !tool.canUseTool()) return null;

        let bestSpot = null;
        let maxValue = -1;

        grid.forEach((tile, index) => {
            const depth = getDepth(tile);

            if (!tile.reward || depth <= 0) return;

            // Value is how many layers chisel will actually remove (max 2)
            const value = Math.min(depth, CONFIG.CHISEL_DEPTH_DAMAGE);
            if (value > maxValue) {
                maxValue = value;
                bestSpot = { ...indexToCoords(index, width), value };
            }
        });

        return bestSpot;
    }

    /**
     * Execute mining: choose between hammer and chisel based on layer progress value.
     * On ties, prefers chisel for focused depth progression over spread hammer damage.
     * Greedy strategy: always use the tool that removes the most layers this turn.
     */
    function performMining(grid, width, totalHeight, tools) {
        const chiselTool = tools.getTool(CONFIG.TOOL_IDS.CHISEL);
        const hammerTool = tools.getTool(CONFIG.TOOL_IDS.HAMMER);

        const hammerMove = findBestHammerMove(grid, width, totalHeight, hammerTool);
        const chiselMove = findBestChiselMove(grid, width, chiselTool);

        // No valuable moves available
        if (!hammerMove && !chiselMove) return;

        // Decide: hammer vs chisel based on layer progress
        // On ties, prefer chisel for focused item completion
        const hammerValue = hammerMove?.value ?? -1;
        const chiselValue = chiselMove?.value ?? -1;

        if (hammerValue > chiselValue && hammerMove) {
            tools.useTool(CONFIG.TOOL_IDS.HAMMER, hammerMove.x, hammerMove.y);
        } else if (chiselMove) {
            tools.useTool(CONFIG.TOOL_IDS.CHISEL, chiselMove.x, chiselMove.y);
        }
    }

    // ============ MAIN LOOP ============

    // Inject the automation and skip discovery toggle buttons once
    injectAutomineToggle();

    setInterval(() => {
        // Early exit: check App availability
        if (typeof App === 'undefined' || !App.game?.underground?.mine) return;

        const mine = App.game.underground.mine;
        const tools = App.game.underground.tools;
        const grid = typeof mine.grid === 'function' ? mine.grid() : mine.grid;

        // Early exit: invalid grid state
        if (!grid || grid.length === 0) return;

        const width = mine.width || CONFIG.DEFAULT_MINE_WIDTH;
        const totalHeight = Math.ceil(grid.length / width);
        const mineSquares = document.querySelectorAll('#mineBody .mineSquare');

        // Update visuals regardless of automation
        updateVisuals(grid, width, mineSquares);

        // Skip discovery timer if enabled
        if (isSkipDiscoveryEnabled() && mine.timeUntilDiscovery > 0) {
            mine._timeUntilDiscovery(0);
        }

        // Skip automation if disabled or mining conditions not met
        if (!isAutomineEnabled() || !canBeginMining(mine, tools)) return;

        // Battery discharge takes priority
        if (manageBattery()) return;

        // Proceed with mining automation
        performMining(grid, width, totalHeight, tools);

    }, CONFIG.CHECK_INTERVAL_MS);
})();