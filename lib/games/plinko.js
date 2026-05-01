/**
 * @fileoverview Plinko game handler (Jungle Plinko)
 *
 * Ball-drop game inspired by the classic Plinko board.
 *
 * Mechanics:
 * - Drop balls from the top of a pegged board
 * - Balls bounce through pegs and land in multiplier buckets
 * - Wager is split evenly across all balls
 * - Each ball's multiplier is determined by VRF randomness
 *
 * Parameters:
 * - mode (0-4): Risk level - higher = more volatile multipliers
 *   - 0 (Safe): Tight range, consistent returns
 *   - 1 (Low): Slightly wider, small upside
 *   - 2 (Medium): Balanced risk/reward (recommended)
 *   - 3 (High): Wide swings, big potential
 *   - 4 (Extreme): Maximum volatility, moonshot multipliers
 *
 * - balls (1-100): Number of balls to drop
 *   - More balls = smoother variance (law of large numbers)
 *   - Wager is divided by ball count (10 APE / 50 balls = 0.2 APE per ball)
 *   - Each ball generates separate VRF randomness (affects gas cost)
 *
 * VRF Cost:
 * Plinko has variable gas costs based on ball count.
 * Formula: baseGas + (balls * perUnitGas)
 * More balls = more randomness = higher VRF fee
 *
 * On-chain encoding:
 * - gameMode: uint8 (0-4)
 * - numBalls: uint8 (1-100)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 *
 * @module lib/games/plinko
 */
import { encodeAbiParameters } from 'viem';
import { ensureIntRange } from '../utils.js';
import { getPlinkoVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Plinko game
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Total wager in wei (split across all balls)
 * @param {number} [params.mode] - Risk mode 0-4 (default: 2)
 * @param {number} [params.balls] - Number of balls 1-100 (default: 50)
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Game response with status and result
 * @throws {Error} If parameters are invalid or transaction fails
 *
 * @example
 * // Medium risk, 50 balls
 * const result = await playPlinko({
 *   account,
 *   publicClient,
 *   walletClient,
 *   gameEntry,
 *   wager: parseEther('10'),
 *   mode: 2,
 *   balls: 50,
 *   timeoutMs: 30000,
 * });
 *
 * // High risk, fewer balls (more variance)
 * const result = await playPlinko({
 *   ...params,
 *   mode: 4,
 *   balls: 10,
 * });
 */
export async function playPlinko({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  mode,
  balls,
  referral,
  timeoutMs,
}) {
  // Validate referral address
  const refAddress = getValidRefAddress(referral);

  // Generate unique identifiers
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  // Validate and normalize parameters using game config limits
  const modeValue = ensureIntRange(
    mode ?? gameEntry.config.mode.default,
    'mode',
    gameEntry.config.mode.min,
    gameEntry.config.mode.max
  );
  const ballsValue = ensureIntRange(
    balls ?? gameEntry.config.balls.default,
    'balls',
    gameEntry.config.balls.min,
    gameEntry.config.balls.max
  );

  // Calculate custom gas limit for VRF fee
  // More balls = more randomness = more gas
  const customGasLimit = gameEntry.vrf.baseGas + (ballsValue * gameEntry.vrf.perUnitGas);
  const vrfFee = await getPlinkoVrfFee(publicClient, gameEntry.contract, customGasLimit);

  // Encode game data for contract
  const encodedData = encodeAbiParameters(
    [
      { name: 'gameMode', type: 'uint8' },
      { name: 'numBalls', type: 'uint8' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
    ],
    [modeValue, ballsValue, gameId, refAddress, userRandomWord]
  );

  const config = {
    mode: modeValue,
    balls: ballsValue,
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
 * Get Plinko config from CLI options or strategy
 *
 * Resolution order for each parameter:
 * 1. Explicit CLI flag (--mode, --balls)
 * 2. Positional argument from CLI
 * 3. Random within strategy's configured range
 *
 * @param {Object} opts - CLI options
 * @param {Object} positionalConfig - Parsed positional arguments
 * @param {Object} strategyConfig - Strategy configuration
 * @param {Function} randomIntInclusive - Random number generator
 * @param {Object} [gameEntry] - Game registry entry (unused, kept for signature uniformity)
 * @returns {Object} { mode: number, balls: number }
 *
 * @example
 * // Strategy 'conservative' has mode [0,1] and balls [80,100]
 * getPlinkoConfig({}, {}, conservativeConfig, randomIntInclusive)
 * // Returns: { mode: 1, balls: 92 } (random within ranges)
 */
export function getPlinkoConfig(opts, positionalConfig, strategyConfig, randomIntInclusive, gameEntry) {
  const config = {};

  // Resolve mode
  if (opts.mode !== undefined) {
    config.mode = parseInt(opts.mode);
  } else if (positionalConfig.mode !== undefined) {
    config.mode = positionalConfig.mode;
  } else {
    const [modeMin, modeMax] = strategyConfig.plinko?.mode || [0, 4];
    config.mode = randomIntInclusive(modeMin, modeMax);
  }

  // Resolve balls
  if (opts.balls !== undefined) {
    config.balls = parseInt(opts.balls);
  } else if (positionalConfig.balls !== undefined) {
    config.balls = positionalConfig.balls;
  } else {
    const [ballMin, ballMax] = strategyConfig.plinko?.balls || [10, 100];
    config.balls = randomIntInclusive(ballMin, ballMax);
  }

  return config;
}
