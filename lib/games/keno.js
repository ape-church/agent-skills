/**
 * @fileoverview Keno game handler
 *
 * Classic lottery-style game where players pick numbers and hope they match.
 *
 * Mechanics:
 * - Player picks 1-10 numbers from a pool of 1-40
 * - Game draws 10 random numbers
 * - Payouts based on how many picks match the draw
 * - More picks = higher risk/reward (hitting 10/10 = 1,000,000x!)
 *
 * Payout Structure (approximate):
 * - 1 pick: Match 1 = 2x
 * - 5 picks: Match 5 = 250x, Match 4 = 15x, Match 3 = 3x
 * - 10 picks: Match 10 = 1,000,000x, Match 9 = 10,000x, etc.
 *
 * Strategy Notes:
 * - Fewer picks = higher hit rate, lower max payout
 * - More picks = lottery-style (rare hits, huge payouts)
 * - Conservative: 1-3 picks
 * - Balanced: 3-6 picks
 * - Degen: 8-10 picks (chasing the million)
 *
 * On-chain encoding:
 * - gameNumbers: uint8[] (1-10 values, each 1-40)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 *
 * @module lib/games/keno
 */
import { encodeAbiParameters } from 'viem';
import { getStaticVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// NUMBER GENERATION/PARSING
// ============================================================================

/**
 * Generate random unique numbers for Keno
 *
 * @param {number} count - How many numbers to generate (1-10)
 * @returns {number[]} Sorted array of unique numbers (1-40)
 */
function generateRandomPicks(count) {
  const picks = new Set();
  while (picks.size < count) {
    const num = Math.floor(Math.random() * 40) + 1; // 1-40
    picks.add(num);
  }
  return Array.from(picks).sort((a, b) => a - b);
}

/**
 * Parse keno numbers from user input or generate random picks
 *
 * @param {string|null} input - Comma-separated numbers or "random"
 * @param {number} pickCount - How many numbers to pick (used for random generation)
 * @returns {number[]} Sorted array of unique numbers
 * @throws {Error} If numbers are invalid, duplicated, or wrong count
 *
 * @example
 * parseKenoNumbers('1,7,13,25,40', 5) // Returns [1, 7, 13, 25, 40]
 * parseKenoNumbers('random', 5)       // Returns 5 random numbers
 * parseKenoNumbers(null, 3)           // Returns 3 random numbers
 */
export function parseKenoNumbers(input, pickCount) {
  // If no input or "random", generate random picks
  if (!input || input.toLowerCase() === 'random') {
    return generateRandomPicks(pickCount);
  }

  // Parse comma-separated numbers
  const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const numbers = [];
  const seen = new Set();

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 1 || num > 40) {
      throw new Error(`Invalid keno number: "${part}". Must be 1-40.`);
    }
    if (seen.has(num)) {
      throw new Error(`Duplicate number: ${num}. Each number can only be picked once.`);
    }
    seen.add(num);
    numbers.push(num);
  }

  if (numbers.length < 1 || numbers.length > 10) {
    throw new Error(`Must pick 1-10 numbers. You picked ${numbers.length}.`);
  }

  return numbers.sort((a, b) => a - b);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Keno game
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Wager in wei
 * @param {number} [params.picks] - Number of picks 1-10 (default: 5)
 * @param {string} [params.numbers] - Specific numbers "1,7,13" or "random"
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Game response with status and result
 * @throws {Error} If parameters are invalid or transaction fails
 *
 * @example
 * // Random 5 picks
 * const result = await playKeno({
 *   account,
 *   publicClient,
 *   walletClient,
 *   gameEntry,
 *   wager: parseEther('10'),
 *   picks: 5,
 *   timeoutMs: 30000,
 * });
 *
 * // Specific numbers
 * const result = await playKeno({
 *   ...params,
 *   numbers: '7,13,21,28,35',
 * });
 */
export async function playKeno({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  picks,
  numbers,
  referral,
  timeoutMs,
}) {
  // Validate referral address
  const refAddress = getValidRefAddress(referral);

  // Generate unique identifiers
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  // Determine pick count (1-10)
  let pickCount = picks ?? gameEntry.config.picks.default;
  if (pickCount < 1) pickCount = 1;
  if (pickCount > 10) pickCount = 10;

  // Parse or generate numbers
  let gameNumbers;
  try {
    gameNumbers = parseKenoNumbers(numbers, pickCount);
  } catch (error) {
    throw error;
  }

  // If user provided specific numbers, use their count
  if (numbers && numbers.toLowerCase?.() !== 'random' && gameNumbers.length !== pickCount) {
    pickCount = gameNumbers.length;
  }

  // Get VRF fee (static for keno)
  const vrfFee = await getStaticVrfFee(publicClient, gameEntry.contract);

  // Encode game data for contract
  const encodedData = encodeAbiParameters(
    [
      { name: 'gameNumbers', type: 'uint8[]' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
    ],
    [gameNumbers, gameId, refAddress, userRandomWord]
  );

  const config = {
    picks: gameNumbers.length,
    numbers: gameNumbers,
  };

  return executeGame({
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
}

// ============================================================================
// CONFIG GETTER
// ============================================================================

/**
 * Get Keno config from CLI options or strategy
 *
 * @param {Object} opts - CLI options
 * @param {Object} positionalConfig - Parsed positional arguments
 * @param {Object} strategyConfig - Strategy configuration
 * @param {Function} randomIntInclusive - Random number generator
 * @returns {Object} { picks: number, numbers?: string }
 */
export function getKenoConfig(opts, positionalConfig, strategyConfig, randomIntInclusive) {
  const config = {};

  // Determine specific numbers first (optional) — affects pick inference below
  if (opts.numbers) {
    config.numbers = opts.numbers;
  } else if (positionalConfig.numbers) {
    config.numbers = positionalConfig.numbers;
  }

  // Determine pick count
  // If specific numbers were provided (and not the literal 'random'), infer
  // the pick count from how many were given — this is what the contract uses.
  if (config.numbers && config.numbers.toLowerCase?.() !== 'random') {
    config.picks = config.numbers.split(',').filter((s) => s.trim()).length;
  } else if (opts.picks !== undefined) {
    config.picks = parseInt(opts.picks);
  } else if (positionalConfig.picks !== undefined) {
    config.picks = positionalConfig.picks;
  } else {
    const [min, max] = strategyConfig.keno?.picks || [3, 6];
    config.picks = randomIntInclusive(min, max);
  }

  return config;
}
