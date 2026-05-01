/**
 * @fileoverview Strategy configuration and game selection for Ape Church CLI
 *
 * Manages the "autopilot" behavior of the CLI:
 * - Strategy presets with different risk levels
 * - Wager calculation based on bankroll percentage
 * - Random game selection with configurable weights
 * - Game parameter selection (mode, balls, spins, etc.)
 * - Adaptive cooldowns based on win/loss streaks
 *
 * Strategy Presets:
 * - conservative: 5% of bankroll, safer games, longer cooldowns
 * - balanced: 8% of bankroll, moderate settings (default)
 * - aggressive: 12% of bankroll, riskier games, shorter cooldowns
 * - degen: 20% of bankroll, highest variance, fastest play
 *
 * @module lib/strategy
 */
import { GAME_REGISTRY, resolveGame } from '../registry.js';
import { DEFAULT_COOLDOWN_MS } from './constants.js';
import { normalizeStrategy } from './profile.js';
import { clampRange, randomIntInclusive, chooseWeighted } from './utils.js';

// ============================================================================
// STRATEGY CONFIGURATION
// ============================================================================

/**
 * Get the full configuration object for a strategy
 *
 * Each strategy defines:
 * - Bet sizing (min, target %, max %)
 * - Cooldown between games
 * - Game-specific parameter ranges
 * - Game selection weights
 *
 * @param {string} strategy - Strategy name (conservative/balanced/aggressive/degen)
 * @returns {Object} Strategy configuration object
 *
 * @example
 * const config = getStrategyConfig('aggressive');
 * // config.targetBetPct = 0.12 (12% of bankroll)
 * // config.plinko.mode = [2, 4] (higher risk modes)
 */
export function getStrategyConfig(strategy) {
  const normalized = normalizeStrategy(strategy);

  // Default weights: all games equally likely
  const defaultWeights = Object.fromEntries(
    GAME_REGISTRY.map((game) => [game.key, 1])
  );

  const configs = {
    // -------------------------------------------------------------------------
    // CONSERVATIVE: Low risk, slow and steady
    // -------------------------------------------------------------------------
    conservative: {
      minBetApe: 1,               // Never bet less than 1 APE
      targetBetPct: 0.05,         // Target 5% of available bankroll
      maxBetPct: 0.1,             // Never exceed 10% in one bet
      baseCooldownMs: 60 * 1000,  // 60 seconds between games

      // Plinko: Low risk modes, lots of balls (more consistent returns)
      plinko: { mode: [0, 1], balls: [80, 100] },

      // Slots: More spins = more averaging
      slots: { spins: [10, 15] },

      // Reel Pirates: Cascading slot — more spins for smoother variance.
      // Floor at 10 spins (10 × 2.5 APE = 25 APE minimum) to avoid hitting the
      // per-spin floor on small bankrolls under conservative bet sizing.
      reelPirates: { spins: [10, 15] },

      // Blizzard Blitz: Same family as Reel Pirates but slightly riskier.
      // Spin range nudges down vs reel-pirates. Autopilot never auto-triggers
      // bonus buy — the 100 APE flat floor doesn't fit normal strategy sizing.
      blizzardBlitz: { spins: [8, 15] },

      // GOTG: Less risky than the other cascading slots (capped at 10 spins).
      // Conservative leans near max for smoother variance.
      gotg: { spins: [8, 10] },

      // Roulette: Hedge with RED,BLACK (nearly break-even)
      roulette: { defaultBet: 'RED,BLACK' },

      // Baccarat: BANKER has slightly better odds
      baccarat: { defaultBet: 'BANKER' },

      // ApeStrong: Higher win chance (60-80%) = lower payouts but more wins
      apestrong: { range: [60, 80] },

      // Speed Crash: Low multipliers = high hit rate, small wins
      speedCrash: { multiplier: [1.2, 1.6] },

      // Keno: Fewer picks = better odds
      keno: { picks: [1, 3] },

      gameWeights: defaultWeights,
    },

    // -------------------------------------------------------------------------
    // BALANCED: Middle ground (default)
    // -------------------------------------------------------------------------
    balanced: {
      minBetApe: 1,
      targetBetPct: 0.08,         // 8% of bankroll
      maxBetPct: 0.15,            // Max 15%
      baseCooldownMs: 30 * 1000,  // 30 seconds

      plinko: { mode: [1, 2], balls: [50, 90] },
      slots: { spins: [7, 12] },
      reelPirates: { spins: [7, 12] },     // Same shape as slots — moderate spin count
      blizzardBlitz: { spins: [6, 10] },   // Slightly riskier than reel-pirates
      gotg: { spins: [6, 10] },            // Less risky — biased toward more spins within 1-10 cap
      roulette: { defaultBet: 'random' },  // Random RED or BLACK
      baccarat: { defaultBet: 'random' },  // Random PLAYER or BANKER
      apestrong: { range: [40, 60] },      // Coin-flip territory
      speedCrash: { multiplier: [1.5, 2.5] }, // Around even-money territory
      keno: { picks: [3, 6] },

      gameWeights: defaultWeights,
    },

    // -------------------------------------------------------------------------
    // AGGRESSIVE: Higher risk, higher potential reward
    // -------------------------------------------------------------------------
    aggressive: {
      minBetApe: 1,
      targetBetPct: 0.12,         // 12% of bankroll
      maxBetPct: 0.25,            // Max 25%
      baseCooldownMs: 15 * 1000,  // 15 seconds (faster play)

      plinko: { mode: [2, 4], balls: [20, 70] },  // Higher variance modes
      slots: { spins: [3, 10] },                   // Fewer spins = more variance
      reelPirates: { spins: [4, 8] },             // Riskier = fewer spins (more cascade swing)
      blizzardBlitz: { spins: [3, 6] },           // Slightly riskier than reel-pirates
      gotg: { spins: [4, 8] },                    // Lower variance — keeps more spins even at aggressive
      roulette: { defaultBet: 'random' },
      baccarat: { defaultBet: 'random' },
      apestrong: { range: [25, 50] },             // Lower odds, higher payouts
      speedCrash: { multiplier: [2, 5] },         // Higher targets = more variance
      keno: { picks: [5, 8] },                    // More picks = higher variance

      gameWeights: defaultWeights,
    },

    // -------------------------------------------------------------------------
    // DEGEN: Maximum risk, YOLO mode
    // -------------------------------------------------------------------------
    degen: {
      minBetApe: 1,
      targetBetPct: 0.2,          // 20% of bankroll per bet
      maxBetPct: 0.35,            // Max 35%
      baseCooldownMs: 10 * 1000,  // 10 seconds (rapid fire)

      plinko: { mode: [3, 4], balls: [10, 40] },  // Highest variance modes
      slots: { spins: [2, 6] },                    // Fewest spins
      reelPirates: { spins: [1, 4] },             // YOLO few-spin cascades
      blizzardBlitz: { spins: [1, 3] },           // YOLO — fewest cascading spins
      gotg: { spins: [2, 5] },                    // Even at degen, GOTG keeps a couple spins (lower variance)
      roulette: { defaultBet: 'random' },
      baccarat: { defaultBet: 'random' },
      apestrong: { range: [5, 30] },              // Moonshot territory
      speedCrash: { multiplier: [3, 50] },        // Moonshot multipliers — rare hits, huge wins
      keno: { picks: [8, 10] },                   // Maximum picks

      gameWeights: defaultWeights,
    },
  };

  return configs[normalized];
}

// ============================================================================
// CONFIGURATION HELPERS
// ============================================================================

/**
 * Merge base game weights with user overrides
 *
 * Users can adjust weights to favor certain games.
 * Weight of 0 = never play, higher weight = more likely.
 *
 * @param {Object} baseWeights - Default weights from strategy
 * @param {Object} overrideWeights - User overrides (partial)
 * @returns {Object} Merged weights
 *
 * @example
 * normalizeWeights(
 *   { 'plinko': 1, 'roulette': 1 },
 *   { 'plinko': 3 }  // 3x more likely to pick plinko
 * )
 */
function normalizeWeights(baseWeights, overrideWeights) {
  const weights = { ...baseWeights };
  if (overrideWeights && typeof overrideWeights === 'object') {
    for (const [key, value] of Object.entries(overrideWeights)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        weights[key] = parsed;
      }
    }
  }
  return weights;
}

/**
 * Normalize a [min, max] range with fallback
 *
 * Ensures the range is valid and properly ordered.
 *
 * @param {Array} range - Input range [min, max]
 * @param {Array} fallback - Fallback if range is invalid
 * @returns {Array} Validated [min, max] range
 */
function normalizeRange(range, fallback) {
  if (!Array.isArray(range) || range.length !== 2) return fallback;
  const min = Number(range[0]);
  const max = Number(range[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  return [Math.min(min, max), Math.max(min, max)];
}

/**
 * Apply user profile overrides to strategy configuration
 *
 * Allows users to customize strategy behavior without changing the preset.
 * Overrides are stored in profile.overrides.
 *
 * Supported overrides:
 * - min_bet_ape: Minimum bet amount
 * - target_bet_pct: Target bet as fraction of bankroll
 * - max_bet_pct: Maximum bet as fraction of bankroll
 * - base_cooldown_ms: Base delay between games
 * - game_weights: Per-game selection weights
 * - plinko: { mode: [min, max], balls: [min, max] }
 * - slots: { spins: [min, max] }
 *
 * @param {Object} strategyConfig - Base strategy configuration
 * @param {Object} overrides - User overrides from profile
 * @returns {Object} Modified configuration
 */
export function applyProfileOverrides(strategyConfig, overrides) {
  const nextConfig = { ...strategyConfig };
  if (!overrides || typeof overrides !== 'object') return nextConfig;

  // Numeric overrides
  if (Number.isFinite(overrides.min_bet_ape)) {
    nextConfig.minBetApe = Math.max(Number(overrides.min_bet_ape), 0);
  }
  if (Number.isFinite(overrides.target_bet_pct)) {
    nextConfig.targetBetPct = Math.max(Number(overrides.target_bet_pct), 0);
  }
  if (Number.isFinite(overrides.max_bet_pct)) {
    nextConfig.maxBetPct = Math.max(Number(overrides.max_bet_pct), 0);
  }
  if (Number.isFinite(overrides.base_cooldown_ms)) {
    nextConfig.baseCooldownMs = Math.max(Number(overrides.base_cooldown_ms), 0);
  }

  // Game weights override
  if (overrides.game_weights) {
    nextConfig.gameWeights = normalizeWeights(nextConfig.gameWeights, overrides.game_weights);
  }

  // Game-specific parameter overrides
  if (overrides.plinko) {
    nextConfig.plinko = {
      ...nextConfig.plinko,
      mode: normalizeRange(overrides.plinko.mode, nextConfig.plinko.mode),
      balls: normalizeRange(overrides.plinko.balls, nextConfig.plinko.balls),
    };
  }

  if (overrides.slots) {
    nextConfig.slots = {
      ...nextConfig.slots,
      spins: normalizeRange(overrides.slots.spins, nextConfig.slots.spins),
    };
  }

  return nextConfig;
}

// ============================================================================
// WAGER CALCULATION
// ============================================================================

/**
 * Calculate wager amount based on available balance and strategy
 *
 * Uses Kelly-criterion-inspired sizing:
 * 1. Calculate target bet (targetBetPct of bankroll)
 * 2. Clamp to [minBetApe, maxBetPct * bankroll]
 * 3. Return 0 if balance is too low
 *
 * @param {number} availableApe - Current APE balance available for betting
 * @param {Object} strategyConfig - Strategy configuration
 * @returns {number} Wager amount in APE (0 if insufficient balance)
 *
 * @example
 * // With 100 APE and balanced strategy (8% target, 15% max):
 * calculateWager(100, balancedConfig) // Returns 8 APE
 *
 * // With 5 APE (below min threshold):
 * calculateWager(5, balancedConfig) // Returns 0
 */
export function calculateWager(availableApe, strategyConfig) {
  // Maximum allowed by strategy
  const maxAllowed = availableApe * strategyConfig.maxBetPct;

  // If max is below minimum bet, can't play
  if (maxAllowed < strategyConfig.minBetApe) return 0;

  // Target bet, floored at minimum
  const target = Math.max(strategyConfig.minBetApe, availableApe * strategyConfig.targetBetPct);

  // Return clamped value
  return Math.min(target, maxAllowed);
}

// ============================================================================
// GAME SELECTION
// ============================================================================

/**
 * Select a game and generate parameters based on strategy
 *
 * Flow:
 * 1. Choose game based on weighted random selection
 * 2. Generate game-specific parameters within strategy ranges
 * 3. Clamp parameters to game's allowed limits
 *
 * @param {Object} strategyConfig - Strategy configuration
 * @returns {Object} { game: string, ...params }
 *
 * @example
 * selectGameAndConfig(balancedConfig)
 * // Returns: { game: 'jungle-plinko', mode: 2, balls: 75 }
 * // Or: { game: 'roulette', bet: 'RED' }
 * // Or: { game: 'ape-strong', range: 55 }
 */
export function selectGameAndConfig(strategyConfig) {
  // Build weighted options from all registered games
  const options = GAME_REGISTRY.map((game) => ({
    value: game.key,
    weight: strategyConfig.gameWeights?.[game.key] ?? 1,
  }));

  // Random selection based on weights
  const gameChoice = chooseWeighted(options);
  const gameEntry = resolveGame(gameChoice);

  if (!gameEntry) {
    // Fallback to first game if resolution fails
    return { game: GAME_REGISTRY[0]?.key || 'jungle-plinko' };
  }

  // -------------------------------------------------------------------------
  // PLINKO-TYPE GAMES (Jungle Plinko, etc.)
  // Parameters: mode (risk level), balls (number to drop)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'plinko') {
    // Clamp strategy range to game's allowed range
    const [modeMin, modeMax] = clampRange(
      strategyConfig.plinko.mode[0],
      strategyConfig.plinko.mode[1],
      gameEntry.config.mode.min,
      gameEntry.config.mode.max
    );
    const [ballMin, ballMax] = clampRange(
      strategyConfig.plinko.balls[0],
      strategyConfig.plinko.balls[1],
      gameEntry.config.balls.min,
      gameEntry.config.balls.max
    );

    const mode = randomIntInclusive(modeMin, modeMax);
    const balls = randomIntInclusive(ballMin, ballMax);

    return { game: gameEntry.key, mode, balls };
  }

  // -------------------------------------------------------------------------
  // SLOTS-TYPE GAMES (Dino Dough, Bubblegum Heist)
  // Parameters: spins (number of slot pulls)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'slots') {
    const [spinMin, spinMax] = clampRange(
      strategyConfig.slots.spins[0],
      strategyConfig.slots.spins[1],
      gameEntry.config.spins.min,
      gameEntry.config.spins.max
    );

    const spins = randomIntInclusive(spinMin, spinMax);

    return { game: gameEntry.key, spins };
  }

  // -------------------------------------------------------------------------
  // REEL PIRATES (cascading slot)
  // Parameters: spins (number of slot pulls)
  // Same shape as slots but with its own per-strategy spin range, since
  // the variance profile (cascading + 2.5 APE/spin minimum) differs.
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'reelpirates') {
    const reelPiratesConfig = strategyConfig.reelPirates || { spins: [4, 10] };

    const [spinMin, spinMax] = clampRange(
      reelPiratesConfig.spins?.[0] ?? 4,
      reelPiratesConfig.spins?.[1] ?? 10,
      gameEntry.config.spins.min,
      gameEntry.config.spins.max
    );

    return {
      game: gameEntry.key,
      spins: randomIntInclusive(spinMin, spinMax),
    };
  }

  // -------------------------------------------------------------------------
  // BLIZZARD BLITZ (cascading slot + bonus buy)
  // Parameters: spins (1-20)
  // Autopilot never auto-triggers bonus buy (100 APE flat floor doesn't fit
  // strategy bet sizing). Riskier presets pick fewer spins.
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'blizzardblitz') {
    const blizzardBlitzConfig = strategyConfig.blizzardBlitz || { spins: [4, 10] };

    const [spinMin, spinMax] = clampRange(
      blizzardBlitzConfig.spins?.[0] ?? 4,
      blizzardBlitzConfig.spins?.[1] ?? 10,
      gameEntry.config.spins.min,
      gameEntry.config.spins.max
    );

    return {
      game: gameEntry.key,
      spins: randomIntInclusive(spinMin, spinMax),
      bonusBuy: false,
    };
  }

  // -------------------------------------------------------------------------
  // GIMBOZ OF THE GALAXY (cascading slot + bonus buy, lower variance)
  // Parameters: spins (1-10)
  // Autopilot never auto-triggers bonus buy. Lower variance than the other
  // cascading slots, so even degen mode keeps a few spins.
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'gotg') {
    const gotgConfig = strategyConfig.gotg || { spins: [5, 10] };

    const [spinMin, spinMax] = clampRange(
      gotgConfig.spins?.[0] ?? 5,
      gotgConfig.spins?.[1] ?? 10,
      gameEntry.config.spins.min,
      gameEntry.config.spins.max
    );

    return {
      game: gameEntry.key,
      spins: randomIntInclusive(spinMin, spinMax),
      bonusBuy: false,
    };
  }

  // -------------------------------------------------------------------------
  // ROULETTE
  // Parameters: bet (color, number, or section)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'roulette') {
    const rouletteConfig = strategyConfig.roulette || { defaultBet: 'random' };
    let bet = rouletteConfig.defaultBet;

    if (bet === 'random') {
      // Random between RED and BLACK (even-money bets)
      bet = Math.random() < 0.5 ? 'RED' : 'BLACK';
    }

    return { game: gameEntry.key, bet };
  }

  // -------------------------------------------------------------------------
  // BACCARAT
  // Parameters: bet (PLAYER, BANKER, or TIE)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'baccarat') {
    const baccaratConfig = strategyConfig.baccarat || { defaultBet: 'random' };
    let bet = baccaratConfig.defaultBet;

    if (bet === 'random') {
      // Random between PLAYER and BANKER (TIE excluded due to high house edge)
      bet = Math.random() < 0.5 ? 'PLAYER' : 'BANKER';
    }

    return { game: gameEntry.key, bet };
  }

  // -------------------------------------------------------------------------
  // APESTRONG (Pick-your-odds dice)
  // Parameters: range (win probability 5-95%)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'apestrong') {
    const apestrongConfig = strategyConfig.apestrong || { range: [40, 60] };

    const [rangeMin, rangeMax] = clampRange(
      apestrongConfig.range[0],
      apestrongConfig.range[1],
      gameEntry.config.range.min,
      gameEntry.config.range.max
    );

    const range = randomIntInclusive(rangeMin, rangeMax);

    return { game: gameEntry.key, range };
  }

  // -------------------------------------------------------------------------
  // SPEED CRASH (instant-win crash game)
  // Parameter: multiplier (decimal, 1.01 - 10000)
  // Note: uses Math.random for decimals — randomIntInclusive only gives ints.
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'speedcrash') {
    const speedCrashConfig = strategyConfig.speedCrash || { multiplier: [1.5, 3] };

    const [low, high] = speedCrashConfig.multiplier;
    const min = Math.max(low, gameEntry.config.multiplier.min);
    const max = Math.min(high, gameEntry.config.multiplier.max);
    const value = min + Math.random() * (max - min);

    return {
      game: gameEntry.key,
      multiplier: parseFloat(value.toFixed(2)),
    };
  }

  // -------------------------------------------------------------------------
  // KENO
  // Parameters: picks (number of numbers to select)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'keno') {
    const kenoConfig = strategyConfig.keno || { picks: [3, 6] };

    const [picksMin, picksMax] = clampRange(
      kenoConfig.picks[0],
      kenoConfig.picks[1],
      gameEntry.config.picks.min,
      gameEntry.config.picks.max
    );

    const picks = randomIntInclusive(picksMin, picksMax);

    return { game: gameEntry.key, picks };
  }

  // -------------------------------------------------------------------------
  // SPEED KENO
  // Parameters: games (batch count), picks (numbers per game)
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'speedkeno') {
    const speedKenoConfig = strategyConfig.speedKeno || { games: [5, 10], picks: [2, 4] };

    const [gamesMin, gamesMax] = clampRange(
      speedKenoConfig.games?.[0] ?? 5,
      speedKenoConfig.games?.[1] ?? 10,
      gameEntry.config.games.min,
      gameEntry.config.games.max
    );
    const [picksMin, picksMax] = clampRange(
      speedKenoConfig.picks?.[0] ?? 2,
      speedKenoConfig.picks?.[1] ?? 4,
      gameEntry.config.picks.min,
      gameEntry.config.picks.max
    );

    return {
      game: gameEntry.key,
      games: randomIntInclusive(gamesMin, gamesMax),
      picks: randomIntInclusive(picksMin, picksMax),
    };
  }

  // -------------------------------------------------------------------------
  // BEAR-A-DICE
  // Parameters: difficulty (0-4), rolls (1-5)
  // Auto-play favors safe play: 90% Easy, 10% Normal — never Hard+
  // Easy mode allows more rolls; harder modes capped to 1-2
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'beardice') {
    const bearDiceConfig = strategyConfig.bearDice || {};

    // 90% Easy / 10% Normal — never auto-pick Hard or above
    const difficulty = Math.random() < 0.9 ? 0 : 1;
    const isEasy = difficulty === 0;

    const [rollsMin, rollsMax] = clampRange(
      bearDiceConfig.rolls?.[0] ?? (isEasy ? 1 : 1),
      bearDiceConfig.rolls?.[1] ?? (isEasy ? 5 : 2),
      gameEntry.config.rolls.min,
      gameEntry.config.rolls.max
    );

    return {
      game: gameEntry.key,
      difficulty,
      rolls: randomIntInclusive(rollsMin, rollsMax),
    };
  }

  // -------------------------------------------------------------------------
  // MONKEY MATCH
  // Parameters: mode (1=Low Risk, 2=Normal Risk)
  // Auto-play favors Low Risk for consistency
  // -------------------------------------------------------------------------
  if (gameEntry.type === 'monkeymatch') {
    // 70% Low Risk / 30% Normal Risk
    const mode = Math.random() < 0.7 ? 1 : 2;
    return { game: gameEntry.key, mode };
  }

  // Fallback for unknown game types
  return { game: gameEntry.key };
}

// ============================================================================
// COOLDOWN CALCULATION
// ============================================================================

/**
 * Compute cooldown between games based on strategy and streaks
 *
 * Adaptive cooldown logic:
 * - On winning streaks: Reduce cooldown (ride the wave)
 * - On losing streaks: Increase cooldown (cool off, don't chase)
 *
 * Limits:
 * - Minimum: 60 seconds (even on hot streaks)
 * - Maximum: 2 hours (even on cold streaks)
 *
 * @param {Object} strategyConfig - Strategy configuration
 * @param {Object} state - Current session state (win/loss streaks)
 * @returns {number} Cooldown in milliseconds
 *
 * @example
 * // Base cooldown: 30s, 3 consecutive wins
 * computeCooldownMs(config, { consecutiveWins: 3 })
 * // Returns: 60000 (60s minimum, 25% of base)
 *
 * // Base cooldown: 30s, 3 consecutive losses
 * computeCooldownMs(config, { consecutiveLosses: 3 })
 * // Returns: 90000 (3x base)
 */
export function computeCooldownMs(strategyConfig, state) {
  const base = strategyConfig.baseCooldownMs || DEFAULT_COOLDOWN_MS;

  // -------------------------------------------------------------------------
  // WINNING STREAK: Play faster
  // -------------------------------------------------------------------------
  if (state.consecutiveWins >= 3) {
    // 3+ wins: 25% of base (min 60s)
    return Math.max(Math.floor(base * 0.25), 60_000);
  }
  if (state.consecutiveWins >= 2) {
    // 2 wins: 50% of base (min 60s)
    return Math.max(Math.floor(base * 0.5), 60_000);
  }

  // -------------------------------------------------------------------------
  // LOSING STREAK: Slow down
  // -------------------------------------------------------------------------
  if (state.consecutiveLosses >= 3) {
    // 3+ losses: 3x base (max 2 hours)
    return Math.min(Math.floor(base * 3), 2 * 60 * 60 * 1000);
  }
  if (state.consecutiveLosses >= 2) {
    // 2 losses: 2x base (max 2 hours)
    return Math.min(Math.floor(base * 2), 2 * 60 * 60 * 1000);
  }

  // No streak: use base cooldown
  return base;
}
