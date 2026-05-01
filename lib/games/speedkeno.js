/**
 * @fileoverview Speed Keno game handler
 *
 * Fast-paced keno variant with batched games for efficiency.
 *
 * Differences from regular Keno:
 * - Smaller pool: Pick 1-5 numbers from 1-20 (vs 1-10 from 1-40)
 * - Batching: Play 1-20 games in a single transaction
 * - Higher hit rates due to smaller pool
 * - Lower max payouts (2000x for 5/5 vs 1,000,000x for 10/10)
 *
 * Mechanics:
 * - Player picks 1-5 numbers from pool of 1-20
 * - Specifies how many games to batch (1-20)
 * - Wager is split evenly across all games
 * - Each game draws numbers independently
 * - Results aggregate in single response
 *
 * Payout Structure:
 * - 5/5 (all 5 picks match): 2000x
 * - 4/4 (all 4 picks match): 100x
 * - 3/3 (all 3 picks match): 20x
 * - 2/2 (all 2 picks match): 4x
 * - 1/1 (single pick matches): 2x
 *
 * VRF Cost:
 * Speed Keno has variable gas costs based on game count.
 * Formula: baseGas + (games * perGameGas)
 * More batched games = higher VRF fee
 *
 * On-chain encoding:
 * - numGames: uint8 (1-20)
 * - gameNumbers: uint8[] (1-5 values, each 1-20)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 *
 * @module lib/games/speedkeno
 */
import { encodeAbiParameters } from 'viem';
import { getPlinkoVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Base gas for VRF fee calculation
 * @type {number}
 */
const BASE_GAS = 325000;

/**
 * Additional gas per batched game
 * @type {number}
 */
const GAS_PER_GAME = 55000;

// ============================================================================
// NUMBER GENERATION/PARSING
// ============================================================================

/**
 * Generate random unique numbers for Speed Keno (1-20 pool)
 *
 * @param {number} count - How many numbers to generate (1-5)
 * @returns {number[]} Sorted array of unique numbers
 */
function generateRandomPicks(count) {
  const picks = new Set();
  while (picks.size < count) {
    const num = Math.floor(Math.random() * 20) + 1; // 1-20
    picks.add(num);
  }
  return Array.from(picks).sort((a, b) => a - b);
}

/**
 * Parse speed keno numbers from user input or generate random picks
 *
 * @param {string|null} input - Comma-separated numbers or "random"
 * @param {number} pickCount - How many numbers to pick (for random generation)
 * @returns {number[]} Sorted array of unique numbers
 * @throws {Error} If numbers are invalid, duplicated, or out of range
 *
 * @example
 * parseSpeedKenoNumbers('1,7,13', 3)  // Returns [1, 7, 13]
 * parseSpeedKenoNumbers('random', 3)  // Returns 3 random numbers from 1-20
 */
export function parseSpeedKenoNumbers(input, pickCount) {
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
    if (isNaN(num) || num < 1 || num > 20) {
      throw new Error(`Invalid speed keno number: "${part}". Must be 1-20.`);
    }
    if (seen.has(num)) {
      throw new Error(`Duplicate number: ${num}. Each number can only be picked once.`);
    }
    seen.add(num);
    numbers.push(num);
  }

  if (numbers.length < 1 || numbers.length > 5) {
    throw new Error(`Must pick 1-5 numbers. You picked ${numbers.length}.`);
  }

  return numbers.sort((a, b) => a - b);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Speed Keno game
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Total wager in wei (split across all games)
 * @param {number} [params.picks] - Number of picks 1-5 (default: 3)
 * @param {string} [params.numbers] - Specific numbers "1,7,13" or "random"
 * @param {number} [params.games] - Number of batched games 1-20 (default: 5)
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Game response with status and result
 * @throws {Error} If parameters are invalid or transaction fails
 *
 * @example
 * // 10 batched games, 3 random picks each
 * const result = await playSpeedKeno({
 *   account,
 *   publicClient,
 *   walletClient,
 *   gameEntry,
 *   wager: parseEther('10'),
 *   picks: 3,
 *   games: 10,
 *   timeoutMs: 30000,
 * });
 * // 10 APE / 10 games = 1 APE per game
 */
export async function playSpeedKeno({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  picks,
  numbers,
  games,
  referral,
  timeoutMs,
}) {
  // Validate referral address
  const refAddress = getValidRefAddress(referral);

  // Generate unique identifiers
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  // Determine number of batched games (1-20)
  let numGames = games ?? gameEntry.config.games.default;
  if (numGames < 1) numGames = 1;
  if (numGames > 20) numGames = 20;

  // Determine pick count (1-5)
  let pickCount = picks ?? gameEntry.config.picks.default;
  if (pickCount < 1) pickCount = 1;
  if (pickCount > 5) pickCount = 5;

  // Parse or generate numbers
  let gameNumbers;
  try {
    gameNumbers = parseSpeedKenoNumbers(numbers, pickCount);
  } catch (error) {
    throw error;
  }

  // If user provided specific numbers, use their count
  if (numbers && numbers.toLowerCase?.() !== 'random') {
    pickCount = gameNumbers.length;
  }

  // Calculate custom gas limit for VRF fee (scales with game count)
  const customGasLimit = BASE_GAS + (numGames * GAS_PER_GAME);

  // Get dynamic VRF fee
  const vrfFee = await getPlinkoVrfFee(publicClient, gameEntry.contract, customGasLimit);

  // Encode game data for contract
  const encodedData = encodeAbiParameters(
    [
      { name: 'numGames', type: 'uint8' },
      { name: 'gameNumbers', type: 'uint8[]' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
    ],
    [numGames, gameNumbers, gameId, refAddress, userRandomWord]
  );

  const config = {
    games: numGames,
    picks: gameNumbers.length,
    numbers: gameNumbers,
    wagerPerGame: (Number(wager) / numGames / 1e18).toFixed(4),
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
 * Get Speed Keno config from CLI options or strategy
 *
 * @param {Object} opts - CLI options
 * @param {Object} positionalConfig - Parsed positional arguments
 * @param {Object} strategyConfig - Strategy configuration
 * @param {Function} randomIntInclusive - Random number generator
 * @returns {Object} { games: number, picks: number, numbers?: string }
 */
export function getSpeedKenoConfig(opts, positionalConfig, strategyConfig, randomIntInclusive) {
  const config = {};

  // Determine number of batched games
  if (opts.games !== undefined) {
    config.games = parseInt(opts.games);
  } else if (positionalConfig.games !== undefined) {
    config.games = positionalConfig.games;
  } else {
    const [min, max] = strategyConfig.speedKeno?.games || [5, 10];
    config.games = randomIntInclusive(min, max);
  }

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
    const [min, max] = strategyConfig.speedKeno?.picks || [2, 4];
    config.picks = randomIntInclusive(min, max);
  }

  return config;
}
