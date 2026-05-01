/**
 * @fileoverview Reel Pirates game handler (cascading slot engine)
 *
 * Mechanics:
 * - Each spin generates a random symbol grid
 * - Winning combos cascade: matched symbols are removed and new ones drop in,
 *   potentially chaining additional wins from the same spin
 * - Includes a 5-free-spin bonus round
 * - Wager splits evenly across all spins (10 APE / 10 spins = 1 APE/spin),
 *   but the contract receives the full wager amount
 *
 * Important: 2.5 APE PER SPIN MINIMUM
 * The contract enforces a per-spin minimum bet. We mirror this client-side
 * so the user gets a clear error instead of a reverted transaction.
 *
 * Risk profile:
 * - Cascading mechanics give near-infinite payout potential
 * - Variance is much higher than non-cascading slots
 * - Riskier strategy presets pick FEWER spins (less averaging)
 * - May take longer than typical games to settle (registry sets a 60s timeout)
 *
 * VRF Cost:
 * Variable gas based on spin count (cascades + bonus rounds = more randomness).
 * Formula: baseGas + (spins * perUnitGas)  — see registry.vrf
 *
 * On-chain encoding (note: numSpins is FIRST, unlike standard slots):
 * - numSpins: uint8 (1-15)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 *
 * @module lib/games/reelpirates
 */
import { encodeAbiParameters, parseEther } from 'viem';
import { ensureIntRange } from '../utils.js';
import { getPlinkoVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Reel Pirates game
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Total wager in wei (must be ≥ spins × 2.5 APE)
 * @param {number} [params.spins] - Number of spins 1-15 (default from registry)
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Game response with status and result
 * @throws {Error} If parameters are invalid, minimum bet is not met, or transaction fails
 *
 * @example
 * // 5 spins, 25 APE wager (5 APE/spin — well above 2.5 minimum)
 * const result = await playReelPirates({
 *   account, publicClient, walletClient, gameEntry,
 *   wager: parseEther('25'),
 *   spins: 5,
 *   timeoutMs: 60000,
 * });
 */
export async function playReelPirates({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  spins,
  referral,
  timeoutMs,
}) {
  const refAddress = getValidRefAddress(referral);
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  // Validate spin count against registry limits
  const spinsValue = ensureIntRange(
    spins ?? gameEntry.config.spins.default,
    'spins',
    gameEntry.config.spins.min,
    gameEntry.config.spins.max,
  );

  // Enforce per-spin minimum bet — contract reverts otherwise.
  // Surface a clear error before submitting the tx so the user doesn't burn gas.
  const minBetPerSpinApe = gameEntry.config.spins.minBetPerSpinApe;
  if (minBetPerSpinApe) {
    const minTotalWei = parseEther(String(minBetPerSpinApe)) * BigInt(spinsValue);
    if (wager < minTotalWei) {
      const minTotalApe = (minBetPerSpinApe * spinsValue).toFixed(2);
      throw new Error(
        `Reel Pirates requires ≥ ${minBetPerSpinApe} APE per spin. ` +
        `For ${spinsValue} spins you need at least ${minTotalApe} APE total. ` +
        `Either increase the wager or reduce --spins.`,
      );
    }
  }

  // Variable VRF fee scales with spin count
  const customGasLimit = gameEntry.vrf.baseGas + (spinsValue * gameEntry.vrf.perUnitGas);
  const vrfFee = await getPlinkoVrfFee(publicClient, gameEntry.contract, customGasLimit);

  // Executor fee — paid on top of wager + VRF, scales per spin.
  // Pays the off-chain bot that processes the cascading game math.
  const executorFeePerSpinApe = gameEntry.config.spins.executorFeePerSpinApe;
  const executorFee = executorFeePerSpinApe
    ? parseEther(String(executorFeePerSpinApe)) * BigInt(spinsValue)
    : 0n;

  // Encode game data — note: numSpins comes BEFORE gameId in this contract
  // (different from the standard slots encoding, which puts gameId first).
  const encodedData = encodeAbiParameters(
    [
      { name: 'numSpins', type: 'uint8' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
    ],
    [spinsValue, gameId, refAddress, userRandomWord],
  );

  const config = {
    spins: spinsValue,
  };

  return executeGame({
    account,
    publicClient,
    walletClient,
    contractAddress: gameEntry.contract,
    encodedData,
    wager,
    vrfFee,
    executorFee,
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
 * Get Reel Pirates config from CLI options or strategy
 *
 * Standard signature: (opts, positionalConfig, strategyConfig, randomIntInclusive, gameEntry)
 *
 * Resolution order:
 * 1. Explicit --spins flag
 * 2. Positional argument from CLI
 * 3. Random within strategy's configured range
 *
 * Note: this getter does NOT scale spins down to fit the wager — it can't,
 * because the wager isn't passed in. The handler validates and throws a clear
 * error if wager × spins doesn't meet the per-spin minimum.
 *
 * @returns {Object} { spins: number }
 */
export function getReelPiratesConfig(opts, positionalConfig, strategyConfig, randomIntInclusive) {
  if (opts.spins !== undefined) {
    return { spins: parseInt(opts.spins) };
  }
  if (positionalConfig.spins !== undefined) {
    return { spins: positionalConfig.spins };
  }
  const [spinMin, spinMax] = strategyConfig.reelPirates?.spins || [4, 10];
  return { spins: randomIntInclusive(spinMin, spinMax) };
}
