/**
 * @fileoverview Blizzard Blitz game handler (cascading slot + bonus buy)
 *
 * Mechanics:
 * - Same cascading slot engine as Reel Pirates: matched symbols are removed,
 *   new ones drop in, can chain multiple wins from a single spin.
 * - 5-free-spin bonus round can be triggered organically OR purchased directly.
 * - Wager splits evenly across spins, but the contract receives the full wager.
 *
 * Bonus buy (`isBonusBuy: true`):
 * - Contract requires numSpins == 1 (we mirror this client-side).
 * - The bet is divided by 32x for the underlying spin math, which is why the
 *   minimum cost is much higher than the per-spin minimum.
 * - Minimum 100 APE total (gameEntry.config.spins.minBonusBuyApe).
 *
 * Normal mode:
 * - Minimum 2.5 APE PER SPIN (gameEntry.config.spins.minBetPerSpinApe).
 * - For 10 spins, that's 25 APE minimum total.
 *
 * Risk profile:
 * - Cascades give near-infinite payout potential — very high variance.
 * - Slightly riskier than Reel Pirates (riskier strategy presets pick fewer spins).
 * - Autopilot does NOT auto-trigger bonus buy — users opt in via --bonus-buy.
 *
 * VRF Cost:
 * Variable gas based on spin count (cascades + bonus rounds = more randomness).
 * Same formula as Reel Pirates: baseGas + (spins * perUnitGas)
 *
 * On-chain encoding (note: numSpins is FIRST, then bool isBonusBuy at the end):
 * - numSpins: uint8 (1-20)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 * - isBonusBuy: bool
 *
 * @module lib/games/blizzardblitz
 */
import { encodeAbiParameters, parseEther } from 'viem';
import { ensureIntRange } from '../utils.js';
import { getPlinkoVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Blizzard Blitz game
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Total wager in wei (≥ spins × 2.5 APE, or ≥ 100 APE for bonus buy)
 * @param {number} [params.spins] - Number of spins 1-20 (forced to 1 if bonusBuy=true)
 * @param {boolean} [params.bonusBuy] - Buy directly into the bonus round
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Game response with status and result
 * @throws {Error} If parameters are invalid, minimum bet is not met, or transaction fails
 *
 * @example
 * // Normal play: 5 spins, 25 APE wager (5 APE/spin)
 * await playBlizzardBlitz({ ...common, wager: parseEther('25'), spins: 5 });
 *
 * // Bonus buy: 1 spin only, 100+ APE total
 * await playBlizzardBlitz({ ...common, wager: parseEther('100'), bonusBuy: true });
 */
export async function playBlizzardBlitz({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  spins,
  bonusBuy,
  referral,
  timeoutMs,
}) {
  const refAddress = getValidRefAddress(referral);
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  const isBonusBuy = Boolean(bonusBuy);
  const minBetPerSpinApe = gameEntry.config.spins.minBetPerSpinApe;
  const minBonusBuyApe = gameEntry.config.spins.minBonusBuyApe;

  let spinsValue;
  if (isBonusBuy) {
    // Bonus buy: contract requires numSpins == 1.
    // Reject conflicting spin requests loudly so the user understands why.
    if (spins !== undefined && Number(spins) !== 1) {
      throw new Error(
        `Bonus buy requires exactly 1 spin (you specified ${spins}). ` +
        `Drop --spins, or remove --bonus-buy if you want a multi-spin run.`,
      );
    }
    spinsValue = 1;

    // Flat APE floor for bonus buy.
    if (minBonusBuyApe) {
      const minWei = parseEther(String(minBonusBuyApe));
      if (wager < minWei) {
        throw new Error(
          `Bonus buy requires ≥ ${minBonusBuyApe} APE total. Increase the wager to continue.`,
        );
      }
    }
  } else {
    // Normal mode: validate spin count and per-spin minimum.
    spinsValue = ensureIntRange(
      spins ?? gameEntry.config.spins.default,
      'spins',
      gameEntry.config.spins.min,
      gameEntry.config.spins.max,
    );

    if (minBetPerSpinApe) {
      const minTotalWei = parseEther(String(minBetPerSpinApe)) * BigInt(spinsValue);
      if (wager < minTotalWei) {
        const minTotalApe = (minBetPerSpinApe * spinsValue).toFixed(2);
        throw new Error(
          `Blizzard Blitz requires ≥ ${minBetPerSpinApe} APE per spin. ` +
          `For ${spinsValue} spins you need at least ${minTotalApe} APE total. ` +
          `Either increase the wager or reduce --spins.`,
        );
      }
    }
  }

  // Variable VRF fee scales with spin count (always 1 for bonus buy)
  const customGasLimit = gameEntry.vrf.baseGas + (spinsValue * gameEntry.vrf.perUnitGas);
  const vrfFee = await getPlinkoVrfFee(publicClient, gameEntry.contract, customGasLimit);

  // Executor fee — paid on top of wager + VRF, scales per spin.
  // Bonus buys count as 1 spin per the contract, so fee = 1 × per-spin amount.
  const executorFeePerSpinApe = gameEntry.config.spins.executorFeePerSpinApe;
  const executorFee = executorFeePerSpinApe
    ? parseEther(String(executorFeePerSpinApe)) * BigInt(spinsValue)
    : 0n;

  // Encode game data — numSpins comes BEFORE gameId, isBonusBuy is the trailing bool.
  const encodedData = encodeAbiParameters(
    [
      { name: 'numSpins', type: 'uint8' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
      { name: 'isBonusBuy', type: 'bool' },
    ],
    [spinsValue, gameId, refAddress, userRandomWord, isBonusBuy],
  );

  const config = {
    spins: spinsValue,
    bonusBuy: isBonusBuy,
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
 * Get Blizzard Blitz config from CLI options or strategy
 *
 * Standard signature: (opts, positionalConfig, strategyConfig, randomIntInclusive, gameEntry)
 *
 * Resolution:
 * - --bonus-buy (or positional "bonus" keyword) → forces { spins: 1, bonusBuy: true }
 *   and immediately returns; explicit --spins != 1 is rejected by the handler.
 * - Otherwise: opts.spins > positional.spins > strategy random range.
 *
 * Note: autopilot never sets bonusBuy. The 100 APE floor would clash with
 * typical strategy bet sizing. Users must opt in explicitly.
 *
 * @returns {Object} { spins: number, bonusBuy: boolean }
 */
export function getBlizzardBlitzConfig(opts, positionalConfig, strategyConfig, randomIntInclusive) {
  // Bonus buy is binary — only triggered by explicit user input.
  if (opts.bonusBuy || positionalConfig.bonusBuy) {
    // If the user also passed --spins, leave it in so the handler can reject it
    // with a clear error rather than silently overriding.
    const explicitSpins = opts.spins !== undefined
      ? parseInt(opts.spins)
      : positionalConfig.spins;
    return {
      bonusBuy: true,
      spins: explicitSpins ?? 1,
    };
  }

  let spins;
  if (opts.spins !== undefined) {
    spins = parseInt(opts.spins);
  } else if (positionalConfig.spins !== undefined) {
    spins = positionalConfig.spins;
  } else {
    const [spinMin, spinMax] = strategyConfig.blizzardBlitz?.spins || [4, 10];
    spins = randomIntInclusive(spinMin, spinMax);
  }

  return { spins, bonusBuy: false };
}
