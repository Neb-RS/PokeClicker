// ==UserScript==
// @name         PokeClicker Hatchery Egg Identifier
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Overlays each hatchery egg with the Pokémon name and catch/shiny status.
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
        CHECK_INTERVAL_MS: 1000,
        OVERLAY_HEIGHT_PX: 20, // Matches .clickable margin-top to avoid pushing egg down
        OVERLAY_BACKGROUND: '#555555',
        STATUS_BALLS: {
            UNCAUGHT: 'https://www.pokeclicker.com/assets/images/pokeball/None.svg',
            CAUGHT:   'https://www.pokeclicker.com/assets/images/pokeball/Pokeball.svg',
            SHINY:    'https://www.pokeclicker.com/assets/images/pokeball/Pokeball-shiny.svg',
        },
    };

    // ============ VISUAL STYLES ============
    const style = document.createElement('style');
    style.innerHTML = `
        .egg-name-overlay {
            display: flex; align-items: center; justify-content: center; gap: 4px;
            width: 100%; height: ${CONFIG.OVERLAY_HEIGHT_PX}px;
            background: ${CONFIG.OVERLAY_BACKGROUND}; color: #fff;
            font-size: 10px; font-weight: bold;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
        }
        .egg-name-overlay img { width: 14px; height: 14px; flex-shrink: 0; }
    `;
    document.head.appendChild(style);

    // ============ UTILITY FUNCTIONS ============

    /**
     * Resolve catch/shiny status for a given Pokémon ID.
     * @param {number} pokemonId - The Pokémon's numeric ID
     * @returns {string} The catch status key mapped to configuration
     */
    function getEggStatus(pokemonId) {
        if (App.game.party.alreadyCaughtPokemon(pokemonId, true)) return 'SHINY';
        if (App.game.party.alreadyCaughtPokemon(pokemonId)) return 'CAUGHT';
        return 'UNCAUGHT';
    }

    /**
     * Safely unwrap a Knockout observable egg slot and return the active egg.
     * @param {number} index - Egg slot index (0–3)
     * @returns {Object|null} The egg object, or null if retrieval fails or slot is empty
     */
    function getActiveEgg(index) {
        try {
            const egg = ko.unwrap(App.game.breeding._eggList[index]);
            if (!egg || (typeof egg.isNone === 'function' && egg.isNone())) return null;
            return egg;
        } catch (e) {
            return null;
        }
    }

    // ============ VISUAL UPDATES ============

    /**
     * Build and return an overlay element for a given egg slot.
     * @param {number} pokemonId - The Pokémon's numeric ID
     * @returns {HTMLElement} The constructed overlay div
     */
    function createOverlay(pokemonId) {
        const name = pokemonMap[pokemonId]?.name ?? '???';
        const status = getEggStatus(pokemonId);

        const overlay = document.createElement('div');
        overlay.className = 'egg-name-overlay';
        overlay.dataset.pokemonId = pokemonId;

        const ball = document.createElement('img');
        ball.src = CONFIG.STATUS_BALLS[status];

        const label = document.createElement('span');
        label.textContent = name;

        overlay.appendChild(ball);
        overlay.appendChild(label);

        return overlay;
    }

    /**
     * Inject or refresh name/status overlays for all egg slots.
     * Removes stale overlays before re-injecting to handle slot changes.
     * Also neutralises the .clickable top margin so the overlay occupies that space.
     */
    function updateOverlays() {
        const slots = document.querySelectorAll('#eggList .eggSlot');

        slots.forEach((slot, index) => {
            // Always clear stale overlay first
            const existingOverlay = slot.querySelector('.egg-name-overlay');
            if (existingOverlay && existingOverlay.dataset.pokemonId === String(egg.pokemon)) return;
            if (existingOverlay) existingOverlay.remove();

            const egg = getActiveEgg(index);
            if (!egg) return;

            const content = slot.querySelector('.content');
            if (!content) return;

            // Use the existing .clickable top margin so the overlay adds no extra height
            const clickable = content.querySelector('.clickable');
            if (clickable && clickable.style.marginTop !== '0px') clickable.style.marginTop = '0';

            // Proceed with UI injection
            content.insertAdjacentElement('afterbegin', createOverlay(egg.pokemon));
        });
    }

    // ============ MAIN LOOP ============

    setInterval(() => {
        // Early exit: check App availability
        if (typeof App === 'undefined' || !App.game?.breeding) return;

        // Update visual overlays for the hatchery
        updateOverlays();

    }, CONFIG.CHECK_INTERVAL_MS);
})();