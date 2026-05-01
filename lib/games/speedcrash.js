/**
 * @fileoverview Speed Crash game handler (instant-win crash game)
 *
 * Mechanics:
 * - Player picks a target multiplier (1.01x to 10,000x)
 * - Game runs an invisible curve that crashes at a random multiplier
 * - Hit target → payout = bet × target
 * - Crash before target → lose entire bet
 *
 * Approximate hit chance ≈ 99% / target_multiplier (mirrors typical ~99% RTP).
 *
 * On-chain encoding:
 * - targetMultiplier: uint256 (scaled by 10,000 — e.g. 2.5x → 25000)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 *
 * After settlement, this handler does an extra getGameInfo read to surface the
 * crash multiplier (where the curve actually crashed) so users can see their
 * near-misses and big wins. Soft-fails if the read errors — the result still
 * comes back with payout/win info from the standard executeGame poll.
 *
 * @module lib/games/speedcrash
 */
import { encodeAbiParameters } from 'viem';
import { getStaticVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * On-chain scale factor for multipliers.
 * Contract stores 1.01x as 10_100, 10,000x as 100_000_000.
 */
const MULTIPLIER_SCALE = 10_000;

/**
 * ABI for getGameInfo — returns the full game result tuple including the
 * crash multiplier. Defined inline since this is the only game that uses it.
 */
const SPEED_CRASH_GAME_INFO_ABI = [
  {
    type: 'function',
    name: 'getGameInfo',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'player', type: 'address' },
          { name: 'betAmount', type: 'uint256' },
          { name: 'targetMultiplier', type: 'uint256' },
          { name: 'crashMultiplier', type: 'uint256' },
          { name: 'totalPayout', type: 'uint256' },
          { name: 'hasEnded', type: 'bool' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
  },
];

// ============================================================================
// MULTIPLIER PARSING
// ============================================================================

/**
 * Parse a user-supplied multiplier value.
 *
 * Accepts:
 *   - number: 2.5
 *   - string: "2.5", "2.5x", "100x"
 *
 * @param {number|string} input
 * @returns {number} Decimal multiplier (e.g. 2.5)
 * @throws {Error} If input can't be parsed to a finite number
 */
function parseMultiplier(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`Invalid multiplier: "${input}". Use a number like 2.5 or "2.5x".`);
    }
    return input;
  }
  if (typeof input !== 'string') {
    throw new Error(`Invalid multiplier: "${input}". Use a number like 2.5 or "2.5x".`);
  }
  const cleaned = input.toLowerCase().replace(/x$/, '').trim();
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid multiplier: "${input}". Use a number like 2.5 or "2.5x".`);
  }
  return num;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Speed Crash game.
 *
 * @param {Object} params
 * @param {import('viem/accounts').PrivateKeyAccount} params.account
 * @param {import('viem').PublicClient} params.publicClient
 * @param {import('viem').WalletClient} params.walletClient
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Wager in wei
 * @param {number|string} [params.multiplier] - Target multiplier (e.g. 2.5 or "2.5x"). Default from registry.
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Response — for completed games, result includes
 *   target_multiplier, crash_multiplier, and hit boolean.
 * @throws {Error} If multiplier is out of range or transaction fails.
 */
export async function playSpeedCrash({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  multiplier,
  referral,
  timeoutMs,
}) {
  const refAddress = getValidRefAddress(referral);
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  // Parse + validate target multiplier against registry-declared range.
  // Done client-side so users get a clear error before the tx is sent.
  const multiplierNum = parseMultiplier(multiplier ?? gameEntry.config.multiplier.default);
  const { min, max } = gameEntry.config.multiplier;
  if (multiplierNum < min || multiplierNum > max) {
    throw new Error(
      `Target multiplier must be between ${min}x and ${max}x. You specified ${multiplierNum}x.`,
    );
  }

  // Convert decimal → on-chain scaled integer (10_000 = 1.00x)
  const targetMultiplierScaled = BigInt(Math.round(multiplierNum * MULTIPLIER_SCALE));

  const vrfFee = await getStaticVrfFee(publicClient, gameEntry.contract);

  const encodedData = encodeAbiParameters(
    [
      { name: 'targetMultiplier', type: 'uint256' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
    ],
    [targetMultiplierScaled, gameId, refAddress, userRandomWord],
  );

  // Approximate hit chance for display — assumes ~99% RTP
  const approxHitChance = (99 / multiplierNum).toFixed(1);

  const config = {
    multiplier: multiplierNum,
    target: `${multiplierNum}x`,
    approxHitChance: `${approxHitChance}%`,
  };

  const response = await executeGame({
    account,
    publicClient,
    walletClient,
    contractAddress: gameEntry.contract,
    encodedData,
    wager,
    vrfFee,
    gameId,
    gameEntry,
    config,
    timeoutMs,
  });

  // If the game settled, fetch the crash multiplier so users can see where it
  // actually crashed. Soft-fail: if this read errors, the response is still
  // valid — just missing the crash detail.
  if (response.status === 'complete' && response.result) {
    try {
      const info = await publicClient.readContract({
        address: gameEntry.contract,
        abi: SPEED_CRASH_GAME_INFO_ABI,
        functionName: 'getGameInfo',
        args: [gameId],
      });
      const crashMultiplier = Number(info.crashMultiplier) / MULTIPLIER_SCALE;
      response.result.target_multiplier = `${multiplierNum}x`;
      response.result.crash_multiplier = `${crashMultiplier.toFixed(2)}x`;
      response.result.hit = crashMultiplier >= multiplierNum;
    } catch {
      // Crash multiplier is a nice-to-have, not load-bearing — continue.
    }
  }

  return response;
}

// ============================================================================
// CONFIG GETTER
// ============================================================================

/**
 * Get Speed Crash config from CLI options or strategy.
 *
 * Standard signature: (opts, positionalConfig, strategyConfig, randomIntInclusive, gameEntry)
 *
 * Note: multipliers are decimals, so this getter does its own random-in-range
 * (the shared randomIntInclusive only handles integers). Returns the value
 * rounded to 2 decimals for clean display.
 *
 * @returns {Object} { multiplier: number }
 */
export function getSpeedCrashConfig(opts, positionalConfig, strategyConfig) {
  if (opts.multiplier !== undefined) {
    return { multiplier: parseMultiplier(opts.multiplier) };
  }
  if (positionalConfig.multiplier !== undefined) {
    return { multiplier: parseMultiplier(positionalConfig.multiplier) };
  }
  const [low, high] = strategyConfig.speedCrash?.multiplier || [1.5, 3];
  const value = low + Math.random() * (high - low);
  return { multiplier: parseFloat(value.toFixed(2)) };
}
