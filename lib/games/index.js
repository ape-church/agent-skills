/**
 * @fileoverview Game Router - Unified entry point for all game types
 *
 * This module provides a single playGame() function that routes to
 * the appropriate game handler based on game type.
 *
 * Architecture:
 * - Each game type has its own handler module (plinko.js, roulette.js, etc.)
 * - Handlers export play*() and get*Config() functions
 * - This router maps game types to handlers and validates input
 *
 * Adding a New Game:
 * 1. Create lib/games/<type>.js with play<Type>() and get<Type>Config()
 * 2. Import the handler here
 * 3. Add to gameHandlers and configGetters maps
 * 4. See ADDING_GAMES.md for full guide
 *
 * @module lib/games/index
 */
import { parseEther } from 'viem';
import { resolveGame, listGames } from '../../registry.js';
import { createClients } from '../wallet.js';
import { sanitizeError } from '../utils.js';

// ============================================================================
// GAME HANDLER IMPORTS
// ============================================================================

import { playPlinko, getPlinkoConfig } from './plinko.js';
import { playSlots, getSlotsConfig } from './slots.js';
import { playRoulette, getRouletteConfig } from './roulette.js';
import { playBaccarat, getBaccaratConfig } from './baccarat.js';
import { playApestrong, getApestrongConfig } from './apestrong.js';
import { playKeno, getKenoConfig } from './keno.js';
import { playSpeedKeno, getSpeedKenoConfig } from './speedkeno.js';
import { playBearDice, getBearDiceConfig } from './beardice.js';
import { playMonkeyMatch, getMonkeyMatchConfig } from './monkeymatch.js';
import { playReelPirates, getReelPiratesConfig } from './reelpirates.js';
import { playBlizzardBlitz, getBlizzardBlitzConfig } from './blizzardblitz.js';
import { playGotg, getGotgConfig } from './gotg.js';
import { playSpeedCrash, getSpeedCrashConfig } from './speedcrash.js';

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

/**
 * Human-readable list of available games for error messages
 * @type {string}
 */
const GAME_LIST = listGames().join(' | ');

/**
 * Map of game types to their play handler functions
 *
 * Each handler takes standardized parameters and returns a response object.
 * Handler signature: async function(params) => response
 *
 * @type {Object<string, Function>}
 */
const gameHandlers = {
  plinko: playPlinko,       // Jungle Plinko (ball drop)
  slots: playSlots,         // Dino Dough, Bubblegum Heist (slot machines)
  roulette: playRoulette,   // American roulette
  baccarat: playBaccarat,   // Classic baccarat
  apestrong: playApestrong, // Pick-your-odds dice
  keno: playKeno,           // Standard keno (1-10 picks from 1-40)
  speedkeno: playSpeedKeno, // Fast keno (1-5 picks from 1-20, batched)
  beardice: playBearDice,   // Bear-A-Dice (avoid unlucky numbers)
  monkeymatch: playMonkeyMatch, // Monkey Match (poker hands from barrels)
  reelpirates: playReelPirates, // Reel Pirates (cascading slot)
  blizzardblitz: playBlizzardBlitz, // Blizzard Blitz (cascading slot + bonus buy)
  gotg: playGotg, // Gimboz Of The Galaxy (cascading slot + bonus buy, lower variance)
  speedcrash: playSpeedCrash, // Speed Crash (instant-win crash game)
};

/**
 * Map of game types to their config getter functions
 *
 * Config getters extract game-specific parameters from CLI options
 * and return a normalized config object.
 *
 * @type {Object<string, Function>}
 */
export const configGetters = {
  plinko: getPlinkoConfig,
  slots: getSlotsConfig,
  roulette: getRouletteConfig,
  baccarat: getBaccaratConfig,
  apestrong: getApestrongConfig,
  keno: getKenoConfig,
  speedkeno: getSpeedKenoConfig,
  beardice: getBearDiceConfig,
  monkeymatch: getMonkeyMatchConfig,
  reelpirates: getReelPiratesConfig,
  blizzardblitz: getBlizzardBlitzConfig,
  gotg: getGotgConfig,
  speedcrash: getSpeedCrashConfig,
};

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Play a game - unified entry point for all game types
 *
 * This is the main function called by the CLI play command.
 * It validates input, resolves the game, and routes to the appropriate handler.
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {string} params.game - Game key or alias (e.g., 'plinko', 'roulette')
 * @param {number|string} params.amountApe - Wager amount in APE
 * @param {number} [params.mode] - Risk mode (plinko, monkey match)
 * @param {number} [params.balls] - Number of balls (plinko)
 * @param {number} [params.spins] - Number of spins (slots)
 * @param {string} [params.bet] - Bet type (roulette, baccarat)
 * @param {number} [params.range] - Win probability % (apestrong)
 * @param {number} [params.picks] - Number of picks (keno)
 * @param {string} [params.numbers] - Specific numbers to pick (keno)
 * @param {number} [params.games] - Number of batched games (speed keno)
 * @param {number} [params.difficulty] - Difficulty level (bear dice)
 * @param {number} [params.rolls] - Number of rolls (bear dice)
 * @param {number} [params.timeoutMs] - How long to wait for result (0 = don't wait)
 * @param {string} [params.referral] - Referral address
 *
 * @returns {Promise<Object>} Response object with status, tx, and result
 * @throws {Error} If game is unknown or parameters are invalid
 *
 * @example
 * // Play Plinko
 * const result = await playGame({
 *   account,
 *   game: 'plinko',
 *   amountApe: 10,
 *   mode: 2,
 *   balls: 50,
 *   timeoutMs: 30000,
 * });
 *
 * // Play Roulette
 * const result = await playGame({
 *   account,
 *   game: 'roulette',
 *   amountApe: 5,
 *   bet: 'RED',
 *   timeoutMs: 30000,
 * });
 */
export async function playGame({
  account,
  game,
  amountApe,
  mode,
  balls,
  spins,
  bet,
  range,
  picks,
  numbers,
  games,
  difficulty,
  rolls,
  bonusBuy,
  multiplier,
  timeoutMs,
  referral,
}) {
  // Normalize game key
  const gameKey = String(game || '').toLowerCase();

  // Validate timeout (default to 0 = don't wait)
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;

  // Resolve game from registry
  const gameEntry = resolveGame(gameKey);
  if (!gameEntry) {
    throw new Error(`Unknown game. Use: ${GAME_LIST}`);
  }

  // Parse wager amount
  let wager;
  try {
    wager = parseEther(String(amountApe));
  } catch (error) {
    throw new Error(`Invalid amount: ${sanitizeError(error)}`);
  }

  // Create blockchain clients
  const { publicClient, walletClient } = createClients(account);

  // Get handler for this game type
  const handler = gameHandlers[gameEntry.type];
  if (!handler) {
    throw new Error(`Unsupported game type: ${gameEntry.type}`);
  }

  // Delegate to game-specific handler
  return handler({
    account,
    publicClient,
    walletClient,
    gameEntry,
    wager,
    // Game-specific parameters (handlers extract what they need)
    mode,
    balls,
    spins,
    bet,
    range,
    picks,
    numbers,
    games,
    difficulty,
    rolls,
    bonusBuy,
    multiplier,
    referral,
    timeoutMs: safeTimeoutMs,
  });
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

/**
 * Re-export registry functions for convenience
 *
 * Allows consumers to import everything from lib/games
 */
export { resolveGame, listGames };

/**
 * Re-export individual config getters
 *
 * Used by strategy selection to get game parameters from CLI options
 */
export { getPlinkoConfig } from './plinko.js';
export { getSlotsConfig } from './slots.js';
export { getRouletteConfig } from './roulette.js';
export { getBaccaratConfig } from './baccarat.js';
export { getApestrongConfig } from './apestrong.js';
export { getKenoConfig } from './keno.js';
export { getSpeedKenoConfig } from './speedkeno.js';
export { getBearDiceConfig } from './beardice.js';
export { getMonkeyMatchConfig } from './monkeymatch.js';
export { getReelPiratesConfig } from './reelpirates.js';
export { getBlizzardBlitzConfig } from './blizzardblitz.js';
export { getGotgConfig } from './gotg.js';
export { getSpeedCrashConfig } from './speedcrash.js';

// ============================================================================
// POSITIONAL ARG PARSING (CLI dispatcher)
// ============================================================================

/**
 * Parse a game's raw CLI positional args into a structured config.
 *
 * Each game type interprets `apechurch play <game> <amount> <...rest>` differently.
 * For example:
 *   plinko 10 2 50         → { mode: 2, balls: 50 }
 *   roulette 10 RED        → { bet: 'RED' }
 *   roulette 10 RED BLACK  → { bet: 'RED,BLACK' }
 *   keno 10 5              → { picks: 5 }
 *   keno 10 1,7,13         → { numbers: '1,7,13' }
 *   speed-keno 10 5 3 1,7  → { games: 5, picks: 3, numbers: '1,7' }
 *
 * Returns an empty object for unknown game types or when configArgs is empty —
 * downstream resolution will fall back to strategy defaults.
 *
 * @param {Object} gameEntry - Game registry entry (must include `type`)
 * @param {string[]} configArgs - Positional args after the game key + amount
 * @returns {Object} Parsed positional config (shape depends on game type)
 */
export function parsePositionalArgs(gameEntry, configArgs) {
  const positionalConfig = {};
  if (!gameEntry || !configArgs || configArgs.length === 0) {
    return positionalConfig;
  }

  switch (gameEntry.type) {
    case 'plinko':
      if (configArgs[0]) positionalConfig.mode = parseInt(configArgs[0]);
      if (configArgs[1]) positionalConfig.balls = parseInt(configArgs[1]);
      break;

    case 'slots':
    case 'reelpirates':
      if (configArgs[0]) positionalConfig.spins = parseInt(configArgs[0]);
      break;

    case 'blizzardblitz':
    case 'gotg': {
      // First positional can be either a spin count or the keyword "bonus".
      // `play blizzard-blitz 100 bonus` (or `gotg 100 bonus`) triggers a bonus buy.
      const first = configArgs[0];
      if (first) {
        if (first.toLowerCase() === 'bonus') {
          positionalConfig.bonusBuy = true;
        } else {
          positionalConfig.spins = parseInt(first);
        }
      }
      break;
    }

    case 'roulette':
    case 'baccarat':
      positionalConfig.bet = configArgs.join(',');
      break;

    case 'apestrong':
      if (configArgs[0]) positionalConfig.range = parseInt(configArgs[0]);
      break;

    case 'speedcrash': {
      // Multiplier is a decimal — accept "2.5" or "2.5x".
      // Pass NaN through on bad input so the handler throws a clear error
      // (matches how plinko/slots etc. handle unparseable positional ints).
      const first = configArgs[0];
      if (first) {
        const cleaned = String(first).toLowerCase().replace(/x$/, '');
        positionalConfig.multiplier = parseFloat(cleaned);
      }
      break;
    }

    case 'keno': {
      // configArgs can be [picks], [numbers], or [picks, numbers]
      // First arg is treated as picks if it's 1-10 with no comma; otherwise as numbers.
      const first = configArgs[0];
      if (!first) break;
      const num = parseInt(first);
      if (!isNaN(num) && num >= 1 && num <= 10 && !first.includes(',')) {
        positionalConfig.picks = num;
        if (configArgs[1]) positionalConfig.numbers = configArgs.slice(1).join(',');
      } else {
        positionalConfig.numbers = configArgs.join(',');
      }
      break;
    }

    case 'speedkeno': {
      // configArgs can be [games], [games, picks], [games, numbers], [games, picks, numbers], or [numbers]
      // First arg = games (1-20 without comma), second = picks (1-5 without comma) OR numbers.
      const first = configArgs[0];
      if (!first) break;
      const num = parseInt(first);
      if (!isNaN(num) && num >= 1 && num <= 20 && !first.includes(',')) {
        positionalConfig.games = num;
        if (configArgs[1]) {
          const second = configArgs[1];
          const pickNum = parseInt(second);
          if (!isNaN(pickNum) && pickNum >= 1 && pickNum <= 5 && !second.includes(',')) {
            positionalConfig.picks = pickNum;
            if (configArgs[2]) positionalConfig.numbers = configArgs.slice(2).join(',');
          } else {
            positionalConfig.numbers = configArgs.slice(1).join(',');
          }
        }
      } else if (first.includes(',')) {
        positionalConfig.numbers = configArgs.join(',');
      }
      break;
    }

    case 'beardice':
      // configArgs can be [difficulty] or [difficulty, rolls]
      if (configArgs[0]) positionalConfig.difficulty = parseInt(configArgs[0]);
      if (configArgs[1]) positionalConfig.rolls = parseInt(configArgs[1]);
      break;

    case 'monkeymatch':
      // configArgs can be [mode] (1=Low Risk, 2=Normal Risk)
      if (configArgs[0]) positionalConfig.mode = parseInt(configArgs[0]);
      break;

    // Unknown game types: return empty config; resolveGameConfig will throw
    // a clearer error if the type is truly unsupported.
    default:
      break;
  }

  return positionalConfig;
}

// ============================================================================
// CONFIG RESOLUTION (CLI dispatcher)
// ============================================================================

/**
 * Resolve a game's config from CLI inputs and any pre-existing values.
 *
 * Single entry point that the CLI uses to fill in game-specific parameters.
 * Routes to the right per-type config getter and applies the standard
 * priority: opts > positional > existing > strategy random.
 *
 * `existingConfig` lets autopilot pre-selections (from selectGameAndConfig)
 * survive even if the user didn't pass a positional or flag for that field.
 * Internally this is merged into positionalConfig so each per-type getter
 * sees them with positional taking priority.
 *
 * @param {Object} gameEntry - Game registry entry (must include `type`)
 * @param {Object} opts - CLI flag options (--mode, --balls, --bet, ...)
 * @param {Object} positionalConfig - Parsed positional args (e.g. `play plinko 10 2 50`)
 * @param {Object} existingConfig - Already-set values (e.g. from autopilot selection)
 * @param {Object} strategyConfig - Resolved strategy preset
 * @param {Function} randomIntInclusive - RNG helper (passed in to keep this module pure)
 * @returns {Object} Final game config — shape depends on game type
 *
 * @throws {Error} If gameEntry.type has no registered config getter
 */
export function resolveGameConfig(
  gameEntry,
  opts,
  positionalConfig,
  existingConfig,
  strategyConfig,
  randomIntInclusive,
) {
  const getter = configGetters[gameEntry.type];
  if (!getter) {
    throw new Error(`Unsupported game type: ${gameEntry.type}`);
  }

  // Merge: positionalConfig overrides existingConfig (positional wins when both present).
  // In practice these are mutually exclusive — fixed-game mode has positional only,
  // autopilot mode has existing only — but the merge handles both safely.
  const mergedPositional = { ...(existingConfig || {}), ...(positionalConfig || {}) };

  // All getters take (opts, positional, strategyConfig, randomIntInclusive, gameEntry).
  // Some don't use the trailing args; passing them is harmless.
  return getter(opts, mergedPositional, strategyConfig, randomIntInclusive, gameEntry);
}

// ============================================================================
// HUMAN-READABLE GAME DESCRIPTIONS
// ============================================================================

/**
 * Difficulty labels for Bear-A-Dice, indexed by difficulty value (0-4)
 * @type {string[]}
 */
const BEAR_DICE_DIFFICULTY_NAMES = ['Easy', 'Normal', 'Hard', 'Extreme', 'Master'];

/**
 * Mode labels for Monkey Match, keyed by mode value
 * @type {Object<number, string>}
 */
const MONKEY_MATCH_MODE_NAMES = { 1: 'Low Risk', 2: 'Normal Risk' };

/**
 * Build a one-line human-readable description of a game + its config.
 *
 * Used by the CLI's `play` command to print "Roulette — RED" etc.
 * Returns just the suffix (caller prepends the game name) so it's flexible.
 *
 * Examples (return values):
 *   plinko       → " (mode 2, 50 balls)"
 *   slots        → " (10 spins)"
 *   roulette     → " — RED"
 *   apestrong    → " (50% chance)"
 *   keno         → " (5 picks)"
 *   speedkeno    → " (5 games, 3 picks)"
 *   beardice     → " (Easy, 1 rolls)"
 *   monkeymatch  → " (Low Risk)"
 *
 * @param {Object} gameEntry - Game registry entry
 * @param {Object} gameConfig - Resolved game config
 * @returns {string} Suffix string (empty string if no extras to show)
 */
export function formatGameDescription(gameEntry, gameConfig) {
  switch (gameEntry.type) {
    case 'plinko':
      return ` (mode ${gameConfig.mode}, ${gameConfig.balls} balls)`;
    case 'slots':
    case 'reelpirates':
      return ` (${gameConfig.spins} spins)`;
    case 'blizzardblitz':
    case 'gotg':
      return gameConfig.bonusBuy ? ' (BONUS BUY)' : ` (${gameConfig.spins} spins)`;
    case 'roulette':
    case 'baccarat':
      return ` — ${gameConfig.bet}`;
    case 'apestrong':
      return ` (${gameConfig.range}% chance)`;
    case 'speedcrash':
      return ` (target ${gameConfig.multiplier}x)`;
    case 'keno':
      return ` (${gameConfig.picks} picks)`;
    case 'speedkeno':
      return ` (${gameConfig.games} games, ${gameConfig.picks} picks)`;
    case 'beardice': {
      const name = BEAR_DICE_DIFFICULTY_NAMES[gameConfig.difficulty] || 'Easy';
      return ` (${name}, ${gameConfig.rolls} rolls)`;
    }
    case 'monkeymatch':
      return ` (${MONKEY_MATCH_MODE_NAMES[gameConfig.mode] || 'Low Risk'})`;
    default:
      return '';
  }
}
