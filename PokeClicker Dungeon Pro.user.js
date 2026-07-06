// ==UserScript==
// @name         PokeClicker Dungeon Pro
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Computes the fastest weighted route to the boss — clearing enemies (all, or just the necessary ones), looting selected chest tiers, then fighting the boss. Optional AutoWalk and Repeat toggles.
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
        CHECK_INTERVAL_MS: 50,
        ACTION_DELAY_MS: 50,
        TILE: { EMPTY: 0, ENEMY: 2, CHEST: 3, BOSS: 4, LADDER: 5 },
        CHEST_TIERS: ['common', 'rare', 'epic', 'legendary', 'mythic'],
        ENEMY_WEIGHT: 20,
        CONTROL_ID: 'neb_pokeclicker_dungeon_controls',
        STORAGE_KEY_AUTOWALK: 'neb_pokeclicker_dungeon_autowalk',
        STORAGE_KEY_REPEAT: 'neb_pokeclicker_dungeon_repeat',
        STORAGE_KEY_CHEST_TIERS: 'neb_pokeclicker_dungeon_chest_tiers',
        STORAGE_KEY_ALL_ENEMIES: 'neb_pokeclicker_dungeon_all_enemies',
    };

    const DIRECTIONS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const CHEST_TIER_COLORS = { common: '#fff', rare: '#1abc9c', epic: '#9b59b6', legendary: '#f1c40f', mythic: '#ff7675' };

    // ============ UI STATE ============
    let autoWalkButton = null;
    let repeatButton = null;
    let allEnemiesButton = null;
    let chestTierButtons = {}; // tier name -> button element

    // ============ DUNGEON RUN STATE ============
    // Everything specific to a single dungeon attempt lives here instead of in
    // scattered module-level variables. A fresh instance is created on entry and
    // dropped (left for GC) on exit, so there's one place state can't half-reset.
    class DungeonRun {
        constructor() {
            this.plan = null;
            this.lastActionTime = 0;
            this.floor = null;

            // Render cache: lets renderBoard touch only cells that actually changed.
            this.boardPainted = false;
            this.visitedCache = new Map();
            this.previousPathSet = new Set();
        }
    }

    let activeRun = null;
    let isStartingDungeon = false;

    /**
     * Get autowalk enabled state from localStorage.
     * @returns {boolean} True if autowalk is enabled
     */
    function isAutoWalkEnabled() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY_AUTOWALK);
        return stored !== null ? JSON.parse(stored) : false; // Default to false
    }

    /**
     * Set autowalk enabled state in localStorage and update button.
     * @param {boolean} enabled - Whether autowalk should be enabled
     */
    function setAutoWalkEnabled(enabled) {
        localStorage.setItem(CONFIG.STORAGE_KEY_AUTOWALK, JSON.stringify(enabled));
        updateAutoWalkButton();
    }

    /**
     * Get repeat enabled state from localStorage.
     * @returns {boolean} True if repeat is enabled
     */
    function isRepeatEnabled() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY_REPEAT);
        return stored !== null ? JSON.parse(stored) : false; // Default to false
    }

    /**
     * Set repeat enabled state in localStorage and update button.
     * @param {boolean} enabled - Whether repeat should be enabled
     */
    function setRepeatEnabled(enabled) {
        localStorage.setItem(CONFIG.STORAGE_KEY_REPEAT, JSON.stringify(enabled));
        updateRepeatButton();
    }

    /**
     * Update button text and styling to reflect current autowalk state.
     */
    function updateAutoWalkButton() {
        if (!autoWalkButton) return;
        const enabled = isAutoWalkEnabled();
        autoWalkButton.textContent = `AutoWalk: ${enabled ? 'ON' : 'OFF'}`;
        autoWalkButton.className = enabled ? 'btn btn-sm btn-success' : 'btn btn-sm btn-danger';
    }

    /**
     * Update button text and styling to reflect current repeat state.
     */
    function updateRepeatButton() {
        if (!repeatButton) return;
        const enabled = isRepeatEnabled();
        repeatButton.textContent = `Repeat: ${enabled ? 'ON' : 'OFF'}`;
        repeatButton.className = enabled ? 'btn btn-sm btn-success' : 'btn btn-sm btn-danger';
    }

    /**
     * Get all-enemies enabled state from localStorage.
     * @returns {boolean} True if all-enemies clearing is enabled
     */
    function isAllEnemiesEnabled() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY_ALL_ENEMIES);
        return stored !== null ? JSON.parse(stored) : false; // Default to false
    }

    /**
     * Set all-enemies enabled state in localStorage, update button, and recompute the route.
     * @param {boolean} enabled - Whether all-enemies clearing should be enabled
     */
    function setAllEnemiesEnabled(enabled) {
        localStorage.setItem(CONFIG.STORAGE_KEY_ALL_ENEMIES, JSON.stringify(enabled));
        updateAllEnemiesButton();
        if (activeRun) activeRun.plan = null;
    }

    /**
     * Update button text and styling to reflect current all-enemies state.
     */
    function updateAllEnemiesButton() {
        if (!allEnemiesButton) return;
        const enabled = isAllEnemiesEnabled();
        allEnemiesButton.textContent = `All Enemies: ${enabled ? 'ON' : 'OFF'}`;
        allEnemiesButton.className = enabled ? 'btn btn-sm btn-success' : 'btn btn-sm btn-danger';
    }

    /**
     * Get the set of chest tiers currently selected for looting.
     * @returns {Set<string>} Selected tier names
     */
    function getSelectedChestTiers() {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY_CHEST_TIERS);
        return new Set(stored !== null ? JSON.parse(stored) : []);
    }

    /**
     * Toggle a single chest tier on/off, persist, and update its button.
     * @param {string} tier - Tier name (e.g. "rare")
     */
    function toggleChestTier(tier) {
        const selected = getSelectedChestTiers();
        selected.has(tier) ? selected.delete(tier) : selected.add(tier);
        localStorage.setItem(CONFIG.STORAGE_KEY_CHEST_TIERS, JSON.stringify([...selected]));
        updateChestTierButton(tier);
        if (activeRun) activeRun.plan = null;
    }

    /**
     * Update a chest tier button's styling: red when off, its own tier color when on.
     * @param {string} tier - Tier name
     */
    function updateChestTierButton(tier) {
        const button = chestTierButtons[tier];
        if (!button) return;
        const enabled = getSelectedChestTiers().has(tier);
        button.style.backgroundColor = enabled ? CHEST_TIER_COLORS[tier] : '#c0392b';
        button.style.color = '#000';
        button.style.borderColor = enabled ? CHEST_TIER_COLORS[tier] : '#c0392b';
    }

    /**
     * Create and inject the AutoWalk and Repeat toggle buttons above the dungeon board.
     * Safe to call repeatedly; only injects once.
     */
    function injectControls() {
        if (autoWalkButton && repeatButton && allEnemiesButton) return;

        const battleContainer = document.getElementById('battleContainer');
        if (!battleContainer || document.getElementById(CONFIG.CONTROL_ID)) return;

        const toggleRow = document.createElement('div');
        toggleRow.id = CONFIG.CONTROL_ID;
        toggleRow.className = 'dungeon-toggle-row';
        toggleRow.style.gap = '0.5rem';

        autoWalkButton = document.createElement('button');
        autoWalkButton.type = 'button';
        autoWalkButton.className = 'btn btn-sm btn-danger';
        autoWalkButton.textContent = 'AutoWalk: OFF';
        autoWalkButton.style.margin = '0';
        autoWalkButton.addEventListener('click', (e) => {
            e.preventDefault();
            setAutoWalkEnabled(!isAutoWalkEnabled());
        });

        repeatButton = document.createElement('button');
        repeatButton.type = 'button';
        repeatButton.className = 'btn btn-sm btn-danger';
        repeatButton.textContent = 'Repeat: OFF';
        repeatButton.style.margin = '0';
        repeatButton.addEventListener('click', (e) => {
            e.preventDefault();
            setRepeatEnabled(!isRepeatEnabled());
        });

        allEnemiesButton = document.createElement('button');
        allEnemiesButton.type = 'button';
        allEnemiesButton.className = 'btn btn-sm btn-danger';
        allEnemiesButton.textContent = 'All Enemies: OFF';
        allEnemiesButton.style.margin = '0';
        allEnemiesButton.addEventListener('click', (e) => {
            e.preventDefault();
            setAllEnemiesEnabled(!isAllEnemiesEnabled());
        });

        toggleRow.appendChild(autoWalkButton);
        toggleRow.appendChild(repeatButton);
        toggleRow.appendChild(allEnemiesButton);
        battleContainer.insertBefore(toggleRow, battleContainer.firstChild);

        const chestRow = document.createElement('div');
        chestRow.className = 'dungeon-toggle-row';
        chestRow.style.gap = '0.5rem';

        CONFIG.CHEST_TIERS.forEach(tier => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-sm';
            button.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
            button.style.margin = '0';
            button.addEventListener('click', (e) => {
                e.preventDefault();
                toggleChestTier(tier);
            });
            chestTierButtons[tier] = button;
            chestRow.appendChild(button);
        });

        battleContainer.insertBefore(chestRow, toggleRow.nextSibling);

        updateAutoWalkButton();
        updateRepeatButton();
        updateAllEnemiesButton();
        CONFIG.CHEST_TIERS.forEach(updateChestTierButton);
    }

    // ============ VISUAL STYLES ============
    const style = document.createElement('style');
    style.innerHTML = `
        .dungeon-toggle-row {
            display: flex; justify-content: center; align-items: center;
            padding: 0.5rem; background-color: rgba(0, 0, 0, 0.05);
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }
        .chest-tier-label {
            position: absolute; width: 100%; top: 50%; transform: translateY(-50%);
            font-size: .6rem; font-weight: bold; text-shadow: 1px 1px 2px black;
            text-align: center; pointer-events: none; z-index: 10;
        }
        /* !important here overrides the game's own inline tile styles — the class
           itself is still just a normal stylesheet rule, not JS forcing importance. */
        .dungeon-tile-enemy   { background: rgba(231,76,60,0.7)   !important; }
        .dungeon-tile-chest   { background: rgba(241,196,15,0.5)  !important; }
        .dungeon-tile-boss    { background: rgba(155,89,182,0.7)  !important; }
        .dungeon-tile-ladder  { background: rgba(46,204,113,0.6)  !important; }
        .dungeon-tile-empty   { background: rgba(255,255,255,0.2) !important; }
        .dungeon-tile-visited { background: transparent           !important; }
        .dungeon-path-highlight {
            outline: 2px solid #00f2ff !important;
            box-shadow: inset 0 0 10px rgba(0,242,255,0.8) !important;
        }
    `;
    document.head.appendChild(style);

    // ============ UTILITY FUNCTIONS ============

    /**
     * Build a string key for a grid coordinate.
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {string} Key in "x,y" format
     */
    function tileKey(x, y) {
        return `${x},${y}`;
    }

    /**
     * Scan the board for the tile this floor's route should end at: the boss
     * tile if this is the final floor, otherwise the ladder tile leading to the next
     * floor. 
     * @param {Array} board - 2D grid of tiles
     * @returns {{x, y} | null} Goal coordinates, or null if neither tile is found
     */
    function findGoalTile(board) {
        let ladder = null;
        for (let y = 0; y < board.length; y++) {
            for (let x = 0; x < board[y].length; x++) {
                const type = board[y][x].type();
                if (type === CONFIG.TILE.BOSS) return { x, y };
                if (type === CONFIG.TILE.LADDER) ladder = { x, y };
            }
        }
        return ladder;
    }

    // ============ MIN-HEAP ============
    // Binary min-heap keyed on `.cost`, used by the Dijkstra pathfinder below.
    class MinHeap {
        constructor() {
            this.items = [];
        }

        push(item) {
            this.items.push(item);
            let i = this.items.length - 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (this.items[parent].cost <= this.items[i].cost) break;
                [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
                i = parent;
            }
        }

        pop() {
            const top = this.items[0];
            const last = this.items.pop();
            if (this.items.length) {
                this.items[0] = last;
                let i = 0;
                while (true) {
                    let smallest = i;
                    const left = 2 * i + 1;
                    const right = 2 * i + 2;
                    if (left < this.items.length && this.items[left].cost < this.items[smallest].cost) smallest = left;
                    if (right < this.items.length && this.items[right].cost < this.items[smallest].cost) smallest = right;
                    if (smallest === i) break;
                    [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
                    i = smallest;
                }
            }
            return top;
        }

        get size() {
            return this.items.length;
        }
    }

    // ============ PATHFINDING ============

    /**
     * Build the set of tiles already walked: the game's real isVisited tiles, plus
     * the player's current position.
     * @param {Array} board - 2D grid of tiles
     * @param {{x, y}} start - Player start position
     * @returns {Set<string>} tileKeys of walked tiles
     */
    function buildVisitedSet(board, start) {
        const visited = new Set([tileKey(start.x, start.y)]);
        board.forEach((row, y) => row.forEach((tile, x) => {
            if (tile.isVisited) visited.add(tileKey(x, y));
        }));
        return visited;
    }

    /**
     * Compute the fastest weighted path between two tiles via Dijkstra.
     * Every step costs 1 — matching the one real AutoWalk move it takes to cross any
     * tile, visited or not — except stepping onto a not-yet-cleared enemy tile, which
     * costs CONFIG.ENEMY_WEIGHT instead. 
     * @param {Array} board - 2D grid of tiles
     * @param {{x, y}} start - Start position
     * @param {{x, y}} goal - Target position
     * @param {Set<string>} visited - tileKeys already walked this route (cleared enemies
     *   on this set no longer cost ENEMY_WEIGHT, since they're already defeated)
     * @returns {{path: Array<{x, y}>, cost: number} | null} Path (excluding start, including goal) and its cost, or null if unreachable
     */
    function computeWeightedPath(board, start, goal, visited) {
        const heap = new MinHeap();
        const bestCost = new Map();
        const goalKey = tileKey(goal.x, goal.y);

        heap.push({ x: start.x, y: start.y, path: [], cost: 0 });

        while (heap.size) {
            const { x, y, path, cost } = heap.pop();
            const key = tileKey(x, y);

            if (bestCost.has(key) && bestCost.get(key) <= cost) continue;
            bestCost.set(key, cost);

            if (key === goalKey) return { path, cost };

            for (const [dx, dy] of DIRECTIONS) {
                const nx = x + dx;
                const ny = y + dy;
                const neighborTile = board[ny]?.[nx];
                if (!neighborTile) continue;

                const nk = tileKey(nx, ny);
                const stepCost = (!visited.has(nk) && neighborTile.type() === CONFIG.TILE.ENEMY) ? CONFIG.ENEMY_WEIGHT : 1;
                heap.push({ x: nx, y: ny, path: path.concat({ x: nx, y: ny }), cost: cost + stepCost });
            }
        }

        return null;
    }

    /**
     * Compute pairwise weighted costs between all given points, against a fixed snapshot
     * of the visited set. Used only to decide visiting *order* — the actual walk later
     * uses the real, growing visited set, so its cost can end up lower than this estimate
     * once a stop is reached via ground already crossed earlier in the route.
     * @param {Array} board - 2D grid of tiles
     * @param {Array<{x, y}>} points - points[0] is the starting position, the rest are stops
     * @param {Set<string>} visitedSnapshot - Static visited set for this estimate
     * @returns {number[][]} distance[i][j] = weighted cost from points[i] to points[j] (Infinity if unreachable)
     */
    function computeDistanceMatrix(board, points, visitedSnapshot) {
        const distance = points.map(() => points.map(() => Infinity));
        for (let i = 0; i < points.length; i++) {
            distance[i][i] = 0;
            for (let j = 0; j < points.length; j++) {
                if (i === j) continue;
                const result = computeWeightedPath(board, points[i], points[j], visitedSnapshot);
                if (result) distance[i][j] = result.cost;
            }
        }
        return distance;
    }

    /**
     * Total cost of visiting point indices in the given order (an open path, not a loop).
     * @param {number[]} order - Sequence of point indices
     * @param {number[][]} distance - Pairwise distance matrix
     * @returns {number} Total path cost
     */
    function pathCost(order, distance) {
        let total = 0;
        for (let i = 0; i < order.length - 1; i++) total += distance[order[i]][order[i + 1]];
        return total;
    }

    /**
     * Build an initial visiting order via nearest-neighbor, starting from index 0 (the start point).
     * @param {number[][]} distance - Pairwise distance matrix
     * @returns {number[]} Point indices in visiting order, index 0 first
     */
    function nearestNeighborOrder(distance) {
        const n = distance.length;
        const visited = new Array(n).fill(false);
        visited[0] = true;
        const order = [0];
        let current = 0;

        for (let step = 1; step < n; step++) {
            let best = -1;
            let bestCost = Infinity;
            for (let j = 0; j < n; j++) {
                if (!visited[j] && distance[current][j] < bestCost) {
                    bestCost = distance[current][j];
                    best = j;
                }
            }
            if (best === -1) break;
            visited[best] = true;
            order.push(best);
            current = best;
        }

        return order;
    }

    /**
     * Refine a visiting order with 2-opt: repeatedly reverse segments if doing so
     * shortens the total path, until no reversal helps. Fixes nearest-neighbor's
     * main weakness — greedily jumping to the closest stop can strand later legs
     * far from everything else, forcing a long detour it never sees coming.
     * The start (index 0 of `order`) is never moved.
     * @param {number[]} order - Initial visiting order
     * @param {number[][]} distance - Pairwise distance matrix
     * @returns {number[]} Improved visiting order
     */
    function twoOptImprove(order, distance) {
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 1; i < order.length - 1; i++) {
                for (let k = i + 1; k < order.length; k++) {
                    const candidate = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
                    if (pathCost(candidate, distance) < pathCost(order, distance) - 1e-9) {
                        order = candidate;
                        improved = true;
                    }
                }
            }
        }
        return order;
    }

    /**
     * Decide a near-optimal visiting order for a set of stops (nearest-neighbor + 2-opt).
     * Order only — does not walk the route or touch the real visited set.
     * @param {Array} board - 2D grid of tiles
     * @param {{x, y}} start - Starting position
     * @param {Array<{x, y}>} stops - Tiles to visit
     * @param {Set<string>} visitedSnapshot - Static visited set for this estimate
     * @returns {Array<{x, y}>} Stops in visiting order
     */
    function orderStops(board, start, stops, visitedSnapshot) {
        if (stops.length === 0) return [];
        const points = [start, ...stops];
        const distance = computeDistanceMatrix(board, points, visitedSnapshot);
        const order = twoOptImprove(nearestNeighborOrder(distance), distance);
        return order.slice(1).map(i => points[i]); // Drop the start node, keep the rest in order.
    }

    /**
     * Walk a fixed sequence of stops, concatenating the weighted paths between them.
     * `visited` is mutated in place as each leg's tiles are added, so later legs (and any
     * route built afterward) can freely re-cross ground already walked instead of repaying
     * cost for it.
     * @param {Array} board - 2D grid of tiles
     * @param {{x, y}} start - Starting position for this leg
     * @param {Array<{x, y}>} orderedStops - Stops to visit, in the order to visit them
     * @param {Set<string>} visited - tileKeys already walked this route; grown as legs complete
     * @param {string|null} tagAction - If set, the exact step that arrives at each stop is
     *   tagged `{ action: tagAction }` so the main loop knows to act there (e.g. open a chest)
     *   rather than just pass through. Intermediate steps are untagged.
     * @returns {{route: Array<{x, y, action}>, endPosition: {x, y}}} Concatenated path and final position
     */
    function routeInOrder(board, start, orderedStops, visited, tagAction = null) {
        let route = [];
        let current = start;

        orderedStops.forEach(stop => {
            const result = computeWeightedPath(board, current, stop, visited);
            if (!result) return; // Unreachable — skip it.

            const lastIndex = result.path.length - 1;
            const taggedPath = result.path.map((step, i) => ({
                ...step,
                action: (tagAction && i === lastIndex) ? tagAction : null,
            }));

            route = route.concat(taggedPath);
            result.path.forEach(({ x, y }) => visited.add(tileKey(x, y)));
            current = stop;
        });

        return { route, endPosition: current };
    }

    /**
     * Scan the board for enemies not yet defeated. Unlike chests, isVisited correctly
     * signals "already cleared" for enemies, so it's safe to filter on directly here.
     * @param {Array} board - 2D grid of tiles
     * @returns {Array<{x, y}>} Remaining enemy coordinates
     */
    function findAllEnemies(board) {
        const enemies = [];
        board.forEach((row, y) => row.forEach((tile, x) => {
            if (tile.type() === CONFIG.TILE.ENEMY && !tile.isVisited) enemies.push({ x, y });
        }));
        return enemies;
    }

    /**
     * Scan the board for chests (still type CHEST, i.e. unopened) whose tier is selected.
     * Note: isVisited flips true on entry, before opening — it can't be used here.
     * @param {Array} board - 2D grid of tiles
     * @param {Set<string>} selectedTiers - Selected tier names
     * @returns {Array<{x, y}>} Qualifying chest coordinates
     */
    function findQualifyingChests(board, selectedTiers) {
        const chests = [];
        board.forEach((row, y) => row.forEach((tile, x) => {
            if (tile.type() !== CONFIG.TILE.CHEST) return;
            const tier = tile.metadata?.tier || 'common';
            if (selectedTiers.has(tier)) chests.push({ x, y });
        }));
        return chests;
    }

    /**
     * Build the full dungeon route in three strict phases, since opening a chest makes
     * remaining enemies tougher — all fighting must finish before any chest opens:
     *   1. Clear  — walk a tour fighting whatever enemies are on the way, but never
     *      opening a chest yet. Stops are every remaining enemy when allEnemiesEnabled,
     *      otherwise only enemies naturally on that route get fought.
     *   2. Loot   — loop back and actually open each qualifying chest. This is ~free
     *      movement since it's re-crossing ground already walked in phase 1.
     *   3. Goal   — path to the floor's goal tile and interact (fight the boss, or step
     *      onto the ladder to advance on non-final floors of multi-floor dungeons).
     * @param {Array} board - 2D grid of tiles
     * @param {{x, y}} start - Player start position
     * @param {{x, y}} goal - Boss or ladder tile position, from findGoalTile
     * @param {Set<string>} selectedTiers - Selected chest tiers
     * @param {boolean} allEnemiesEnabled - Clear every enemy instead of just the necessary ones
     * @returns {Array<{x, y, action}>} Full path to walk
     */
    function planRoute(board, start, goal, selectedTiers, allEnemiesEnabled) {
        const qualifyingChests = findQualifyingChests(board, selectedTiers);
        const visited = buildVisitedSet(board, start);

        // Phase 1: clear enemies — either everything, or just what's on the way to the chests/goal.
        const clearingStops = allEnemiesEnabled ? findAllEnemies(board) : qualifyingChests;
        const clearingOrder = orderStops(board, start, clearingStops, new Set(visited));
        const clearingLeg = routeInOrder(board, start, clearingOrder, visited);
        const clearingToGoal = computeWeightedPath(board, clearingLeg.endPosition, goal, visited);
        clearingToGoal?.path.forEach(({ x, y }) => visited.add(tileKey(x, y)));
        const afterClearing = clearingToGoal ? goal : clearingLeg.endPosition;

        // Phase 2: board is clear — loop back and open each qualifying chest.
        const lootingOrder = orderStops(board, afterClearing, qualifyingChests, new Set(visited));
        const lootingLeg = routeInOrder(board, afterClearing, lootingOrder, visited, 'openChest');

        // Phase 3: head to the goal tile (boss fight, or ladder to the next floor) and interact.
        const goalLeg = computeWeightedPath(board, lootingLeg.endPosition, goal, visited);

        return [...clearingLeg.route, ...(clearingToGoal?.path ?? []), ...lootingLeg.route, ...(goalLeg?.path ?? [])];
    }

    // ============ VISUAL UPDATES ============

    const TILE_BACKGROUND_CLASSES = ['dungeon-tile-enemy', 'dungeon-tile-chest', 'dungeon-tile-boss', 'dungeon-tile-ladder', 'dungeon-tile-empty', 'dungeon-tile-visited'];

    /**
     * Resolve the background class for a tile that hasn't been visited yet.
     * @param {Object} tile - Board tile
     * @returns {string} CSS class name
     */
    function unvisitedTileClass(tile) {
        const type = tile.type();
        if (type === CONFIG.TILE.ENEMY) return 'dungeon-tile-enemy';
        if (type === CONFIG.TILE.CHEST) return 'dungeon-tile-chest';
        if (type === CONFIG.TILE.BOSS)  return 'dungeon-tile-boss';
        if (type === CONFIG.TILE.LADDER) return 'dungeon-tile-ladder';
        return 'dungeon-tile-empty';
    }

    /**
     * Swap a cell's background class, removing any other tile-background class first.
     * @param {HTMLElement} cell - Table cell for the tile
     * @param {string} className - One of TILE_BACKGROUND_CLASSES
     */
    function setTileBackgroundClass(cell, className) {
        cell.classList.remove(...TILE_BACKGROUND_CLASSES);
        cell.classList.add(className);
    }

    /**
     * Attach a tier-colored label to an unvisited chest tile.
     * @param {HTMLElement} cell - Table cell for the tile
     * @param {Object} tile - Board tile
     */
    function addChestLabel(cell, tile) {
        const tier = tile.metadata?.tier || 'common';
        const label = document.createElement('div');
        label.className = 'chest-tier-label';
        label.innerText = tier.charAt(0).toUpperCase() + tier.slice(1);
        label.style.color = CHEST_TIER_COLORS[tier] || '#fff';
        cell.appendChild(label);
    }

    /**
     * Paint tile-type backgrounds and highlight the committed path via CSS classes,
     * touching only cells that actually changed since the last call (initial paint,
     * a tile becoming visited, or the path shrinking/moving by a step).
     * @param {Array} board - 2D grid of tiles
     * @param {Array<{x, y}>} path - Remaining path steps
     * @param {DungeonRun} run - Current run, for its render cache
     */
    function renderBoard(board, path, run) {
        const table = document.querySelector('.dungeon-board');
        if (!table) return;

        // One-time full paint: tile types rarely change, so this only needs to happen once per dungeon.
        if (!run.boardPainted) {
            board.forEach((row, y) => row.forEach((tile, x) => {
                const cell = table.rows[y]?.cells[x];
                if (!cell) return;
                setTileBackgroundClass(cell, tile.isVisited ? 'dungeon-tile-visited' : unvisitedTileClass(tile));
                if (!tile.isVisited && tile.type() === CONFIG.TILE.CHEST) addChestLabel(cell, tile);
                run.visitedCache.set(tileKey(x, y), tile.isVisited);
            }));
            run.boardPainted = true;
        } else {
            // Repaint only tiles whose visited status flipped (enemy cleared, chest opened, etc.).
            board.forEach((row, y) => row.forEach((tile, x) => {
                const key = tileKey(x, y);
                if (tile.isVisited && !run.visitedCache.get(key)) {
                    const cell = table.rows[y]?.cells[x];
                    if (cell) {
                        setTileBackgroundClass(cell, 'dungeon-tile-visited');
                        cell.querySelector('.chest-tier-label')?.remove();
                    }
                    run.visitedCache.set(key, true);
                }
            }));
        }

        // Diff the path highlight against what's currently drawn.
        const newPathSet = new Set((path || []).map(({ x, y }) => tileKey(x, y)));

        run.previousPathSet.forEach(key => {
            if (newPathSet.has(key)) return;
            const [x, y] = key.split(',').map(Number);
            table.rows[y]?.cells[x]?.classList.remove('dungeon-path-highlight');
        });

        newPathSet.forEach(key => {
            if (run.previousPathSet.has(key)) return;
            const [x, y] = key.split(',').map(Number);
            table.rows[y]?.cells[x]?.classList.add('dungeon-path-highlight');
        });

        run.previousPathSet = newPathSet;
    }

    // ============ MAIN LOOP ============

    setInterval(() => {
        injectControls();

        // Not in a dungeon: drop the run state and optionally auto-restart.
        if (App.game.gameState !== GameConstants.GameState.dungeon) {
            activeRun = null;

            if (isRepeatEnabled() && !isStartingDungeon) {
                const startButton = document.querySelector('.btn.btn-success[onclick*="initializeDungeon"]');
                if (startButton && !startButton.classList.contains('disabled')) {
                    startButton.click();
                    isStartingDungeon = true;
                }
            }
            return;
        }

        isStartingDungeon = false;
        if (!activeRun) activeRun = new DungeonRun();

        const floor = DungeonRunner.map.playerPosition().floor;
        const board = DungeonRunner.map.board()[floor];
        if (!board) return;

        // A ladder interaction moves the player to a new floor with its own board —
        // the cached plan and render state belong to the floor just left, so drop them
        // and start fresh rather than sitting idle with a drained, never-recomputed plan.
        if (activeRun.floor !== floor) {
            activeRun.floor = floor;
            activeRun.plan = null;
            activeRun.boardPainted = false;
            activeRun.visitedCache = new Map();
            activeRun.previousPathSet = new Set();
        }

        // Combat (or the post-victory catch attempt) blocks everything else — wait it
        // out. These are the same flags DungeonMap.hasAccessToTile itself checks before
        // allowing any move, so this stays in lockstep with the engine's own gating.
        const inCombat = DungeonRunner.fighting() || DungeonBattle.catching();
        if (inCombat) return;

        // Compute the path once per floor. It is walked in full and never replanned
        // mid-run, so enemies on it are fought, not avoided.
        if (activeRun.plan === null) {
            const goal = findGoalTile(board);
            const start = DungeonRunner.map.playerPosition();
            const selectedTiers = getSelectedChestTiers();
            const allEnemies = isAllEnemiesEnabled();

            if (!goal) {
                activeRun.plan = [];
            } else if (!allEnemies && selectedTiers.size === 0) {
                activeRun.plan = computeWeightedPath(board, start, goal, buildVisitedSet(board, start))?.path ?? [];
            } else {
                activeRun.plan = planRoute(board, start, goal, selectedTiers, allEnemies);
            }
        }

        renderBoard(board, activeRun.plan, activeRun);

        if (!isAutoWalkEnabled()) return;

        const now = Date.now();
        if (now - activeRun.lastActionTime <= CONFIG.ACTION_DELAY_MS) return;

        const playerPos = DungeonRunner.map.playerPosition();
        const playerKey = tileKey(playerPos.x, playerPos.y);

        // Advance the plan once the player reaches the next committed step, noting
        // whether that step was tagged for an action (e.g. opening a chest).
        let arrivedAction = null;
        if (activeRun.plan.length > 0 && tileKey(activeRun.plan[0].x, activeRun.plan[0].y) === playerKey) {
            arrivedAction = activeRun.plan[0].action ?? null;
            activeRun.plan.shift();
        }

        const currentTile = DungeonRunner.map.currentTile();

        // Standing on a chest during the phase-2 loot pass: open it directly via the
        // engine's own openChest().
        if (currentTile.type() === CONFIG.TILE.CHEST && arrivedAction === 'openChest') {
            const tier = currentTile.metadata?.tier || 'common';
            if (getSelectedChestTiers().has(tier)) {
                DungeonRunner.openChest();
                activeRun.lastActionTime = now;
                return;
            }
        }

        // Standing on the goal tile with the path complete: fight the boss, or step
        // onto the ladder to advance to the next floor.
        const isGoalTile = currentTile.type() === CONFIG.TILE.BOSS || currentTile.type() === CONFIG.TILE.LADDER;
        if (isGoalTile && activeRun.plan.length === 0 && !DungeonRunner.fightingBoss()) {
            DungeonRunner.handleInteraction();
            activeRun.lastActionTime = now;
            return;
        }

        if (activeRun.plan.length > 0) {
            DungeonRunner.map.moveToCoordinates(activeRun.plan[0].x, activeRun.plan[0].y);
            activeRun.lastActionTime = now;
        }

    }, CONFIG.CHECK_INTERVAL_MS);
})();