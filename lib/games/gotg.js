/**
 * @fileoverview Gimboz Of The Galaxy game handler (cascading slot + bonus buy)
 *
 * Lower-variance cousin of Blizzard Blitz:
 * - Same encoding shape (5 fields with isBonusBuy bool)
 * - Capped at 10 spins (vs Blizzard Blitz's 20, Reel Pirates' 15)
 * - Higher per-spin minimum (3 APE vs 2.5)
 * - Higher executor fee (0.05 APE vs 0.04)
 * - Same bonus-buy semantics: numSpins == 1, ≥ 100 APE
 *
 * Note on duplication: this handler is structurally identical to
 * lib/games/blizzardblitz.js — only the registry-driven values differ.
 * If a fourth cascading-slot game gets added, consider extracting a shared
 * `playCascadingSlot` helper that reads everything from gameEntry.config.
 *
 * On-chain encoding:
 * - numSpins: uint8 (1-10)
 * - gameId: uint256
 * - ref: address (referral)
 * - userRandomWord: bytes32 (client entropy)
 * - isBonusBuy: bool
 *
 * @module lib/games/gotg
 */
import { encodeAbiParameters, parseEther } from 'viem';
import { ensureIntRange } from '../utils.js';
import { getPlinkoVrfFee, executeGame, randomBytes32, randomUint256, getValidRefAddress } from './base.js';

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Play a Gimboz Of The Galaxy game
 *
 * @param {Object} params - Game parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {Object} params.gameEntry - Game registry entry
 * @param {bigint} params.wager - Total wager in wei (≥ spins × 3 APE, or ≥ 100 APE for bonus buy)
 * @param {number} [params.spins] - Number of spins 1-10 (forced to 1 if bonusBuy=true)
 * @param {boolean} [params.bonusBuy] - Buy directly into the bonus round
 * @param {string} [params.referral] - Referral address
 * @param {number} params.timeoutMs - How long to wait for result
 *
 * @returns {Promise<Object>} Game response with status and result
 * @throws {Error} If parameters are invalid, minimum bet is not met, or transaction fails
 */
export async function playGotg({
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
    // Contract requires numSpins == 1 for bonus buys.
    if (spins !== undefined && Number(spins) !== 1) {
      throw new Error(
        `Bonus buy requires exactly 1 spin (you specified ${spins}). ` +
        `Drop --spins, or remove --bonus-buy if you want a multi-spin run.`,
      );
    }
    spinsValue = 1;

    if (minBonusBuyApe) {
      const minWei = parseEther(String(minBonusBuyApe));
      if (wager < minWei) {
        throw new Error(
          `Bonus buy requires ≥ ${minBonusBuyApe} APE total. Increase the wager to continue.`,
        );
      }
    }
  } else {
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
          `Gimboz Of The Galaxy requires ≥ ${minBetPerSpinApe} APE per spin. ` +
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
  const executorFeePerSpinApe = gameEntry.config.spins.executorFeePerSpinApe;
  const executorFee = executorFeePerSpinApe
    ? parseEther(String(executorFeePerSpinApe)) * BigInt(spinsValue)
    : 0n;

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
 * Get Gimboz Of The Galaxy config from CLI options or strategy
 *
 * Standard signature: (opts, positionalConfig, strategyConfig, randomIntInclusive, gameEntry)
 *
 * Resolution mirrors Blizzard Blitz:
 * - --bonus-buy / positional "bonus" → { spins: 1, bonusBuy: true }
 * - Otherwise: opts > positional > strategy random range.
 *
 * Autopilot never sets bonusBuy (100 APE flat floor doesn't fit strategy sizing).
 *
 * @returns {Object} { spins: number, bonusBuy: boolean }
 */
export function getGotgConfig(opts, positionalConfig, strategyConfig, randomIntInclusive) {
  if (opts.bonusBuy || positionalConfig.bonusBuy) {
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
    const [spinMin, spinMax] = strategyConfig.gotg?.spins || [5, 10];
    spins = randomIntInclusive(spinMin, spinMax);
  }

  return { spins, bonusBuy: false };
}
