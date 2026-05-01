/**
 * @fileoverview Base game utilities - shared logic for all game types
 *
 * Provides the common infrastructure used by all game handlers:
 * - VRF (Verifiable Random Function) fee retrieval
 * - Transaction execution with retry logic
 * - Result polling via contract reads
 * - History tracking
 *
 * Architecture Note:
 * We use polling via getEssentialGameInfo instead of event watching.
 * Public RPCs have unreliable WebSocket filter persistence, causing
 * "filter not found" errors. Polling is more reliable for our use case.
 *
 * @module lib/games/base
 */
import { formatEther } from 'viem';
import { GAME_CONTRACT_ABI, PLINKO_VRF_ABI, SLOTS_VRF_ABI } from '../constants.js';
import { sanitizeError, randomBytes32, randomUint256, getValidRefAddress, formatApeAmount } from '../utils.js';
import { saveGameToHistory } from '../profile.js';

// ============================================================================
// VRF FEE RETRIEVAL
// ============================================================================

/**
 * Get VRF fee from contract (static type)
 *
 * Used by games that have fixed VRF costs (Roulette, Baccarat, ApeStrong, etc.)
 * These games need only one random number regardless of parameters.
 *
 * @param {import('viem').PublicClient} publicClient - viem public client
 * @param {string} contractAddress - Game contract address
 * @returns {Promise<bigint>} VRF fee in wei
 * @throws {Error} If contract read fails
 *
 * @example
 * const vrfFee = await getStaticVrfFee(publicClient, '0x...');
 * // Returns: 1000000000000000n (example: 0.001 APE)
 */
export async function getStaticVrfFee(publicClient, contractAddress) {
  try {
    return await publicClient.readContract({
      address: contractAddress,
      abi: SLOTS_VRF_ABI,
      functionName: 'getVRFFee',
    });
  } catch (error) {
    throw new Error(`Failed to read VRF fee: ${sanitizeError(error)}`);
  }
}

/**
 * Get VRF fee from contract (plinko type with custom gas limit)
 *
 * Used by games where VRF cost scales with parameters (Plinko, Speed Keno, Bear-A-Dice).
 * More balls/games/rolls = more random numbers = higher gas = higher fee.
 *
 * Formula: baseGas + (units * perUnitGas)
 *
 * @param {import('viem').PublicClient} publicClient - viem public client
 * @param {string} contractAddress - Game contract address
 * @param {number} customGasLimit - Calculated gas limit based on game parameters
 * @returns {Promise<bigint>} VRF fee in wei
 * @throws {Error} If contract read fails
 *
 * @example
 * // Plinko with 50 balls: baseGas=289000, perUnit=11000
 * const gasLimit = 289000 + (50 * 11000); // 839000
 * const vrfFee = await getPlinkoVrfFee(publicClient, '0x...', gasLimit);
 */
export async function getPlinkoVrfFee(publicClient, contractAddress, customGasLimit) {
  try {
    return await publicClient.readContract({
      address: contractAddress,
      abi: PLINKO_VRF_ABI,
      functionName: 'getVRFFee',
      args: [customGasLimit],
    });
  } catch (error) {
    throw new Error(`Failed to read VRF fee: ${sanitizeError(error)}`);
  }
}

// ============================================================================
// GAME EXECUTION
// ============================================================================

/**
 * Send game transaction and wait for result
 *
 * Main entry point for executing any game. Handles:
 * 1. Transaction submission with automatic retry (1 retry on failure)
 * 2. History tracking (saves game to local history file)
 * 3. Result polling via contract reads
 *
 * Flow:
 * 1. Submit play() transaction with encoded game data
 * 2. If tx fails, wait 2s and retry once
 * 3. Save game to history for later verification
 * 4. Poll getEssentialGameInfo until game completes or timeout
 * 5. Return response with status and results
 *
 * @param {Object} params - Game execution parameters
 * @param {import('viem/accounts').PrivateKeyAccount} params.account - Player's account
 * @param {import('viem').PublicClient} params.publicClient - viem public client
 * @param {import('viem').WalletClient} params.walletClient - viem wallet client
 * @param {string} params.contractAddress - Game contract address
 * @param {string} params.encodedData - ABI-encoded game parameters
 * @param {bigint} params.wager - Bet amount in wei
 * @param {bigint} params.vrfFee - VRF fee in wei
 * @param {bigint} [params.executorFee=0n] - Executor fee in wei (only some games — paid on top of wager + VRF fee, included in tx value)
 * @param {bigint} params.gameId - Unique game identifier
 * @param {Object} params.gameEntry - Game registry entry
 * @param {Object} params.config - Game configuration (for response)
 * @param {number} params.timeoutMs - How long to wait for result (0 = don't wait)
 *
 * @returns {Promise<Object>} Response object with status, tx hash, and result
 *
 * @example
 * const response = await executeGame({
 *   account,
 *   publicClient,
 *   walletClient,
 *   contractAddress: '0x...',
 *   encodedData: encodedParams,
 *   wager: parseEther('10'),
 *   vrfFee: vrfFeeWei,
 *   gameId: randomUint256(),
 *   gameEntry: rouletteEntry,
 *   config: { bet: 'RED' },
 *   timeoutMs: 30000,
 * });
 *
 * // Response structure:
 * // {
 * //   status: 'complete' | 'pending',
 * //   action: 'bet',
 * //   game: 'roulette',
 * //   tx: '0x...',
 * //   gameId: '12345...',
 * //   game_url: 'https://ape.church/games/roulette?id=...',
 * //   wager_ape: '10.000000',
 * //   result: { buy_in_ape: '10.0', payout_ape: '20.5' }
 * // }
 */
export async function executeGame({
  account,
  publicClient,
  walletClient,
  contractAddress,
  encodedData,
  wager,
  vrfFee,
  executorFee = 0n,
  gameId,
  gameEntry,
  config,
  timeoutMs,
}) {
  // Total transaction value = bet amount + VRF fee + executor fee (if any).
  // Executor fee is only used by games that incentivize off-chain processors
  // (currently Reel Pirates and Blizzard Blitz — see registry).
  const totalValue = wager + vrfFee + executorFee;

  // Build game URL for verification on ape.church
  const gameUrl = `https://www.ape.church/games/${gameEntry.slug}?id=${gameId.toString()}`;

  // -------------------------------------------------------------------------
  // TRANSACTION SUBMISSION (with 1 retry)
  // -------------------------------------------------------------------------
  let txHash;
  let lastError;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      txHash = await walletClient.writeContract({
        address: contractAddress,
        abi: GAME_CONTRACT_ABI,
        functionName: 'play',
        args: [account.address, encodedData],
        value: totalValue,
      });
      break; // Success
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        // Wait 2 seconds before retry (nonce/rate limit recovery)
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (!txHash) {
    throw new Error(`Transaction failed: ${sanitizeError(lastError)}`);
  }

  // -------------------------------------------------------------------------
  // HISTORY TRACKING
  // -------------------------------------------------------------------------
  saveGameToHistory({
    contract: contractAddress,
    gameId: gameId.toString(),
    timestamp: Date.now(),
  });

  // -------------------------------------------------------------------------
  // BUILD RESPONSE
  // -------------------------------------------------------------------------
  const response = {
    status: 'pending',
    action: 'bet',
    game: gameEntry.key,
    contract: contractAddress,
    tx: txHash,
    gameId: gameId.toString(),
    game_url: gameUrl,
    config,
    wager_wei: wager.toString(),
    wager_ape: formatEther(wager),
    vrf_fee_wei: vrfFee.toString(),
    vrf_fee_ape: formatEther(vrfFee),
    executor_fee_wei: executorFee.toString(),
    executor_fee_ape: formatEther(executorFee),
    total_value_wei: totalValue.toString(),
    total_value_ape: formatEther(totalValue),
    result: null,
  };

  // -------------------------------------------------------------------------
  // RESULT POLLING
  // -------------------------------------------------------------------------
  // If timeoutMs is 0, return immediately without waiting for result
  if (timeoutMs === 0) {
    return response;
  }

  // Poll contract every second until game completes or timeout
  const pollInterval = 1000; // 1 second
  const maxPollAttempts = Math.ceil(timeoutMs / pollInterval);

  for (let pollAttempt = 0; pollAttempt < maxPollAttempts; pollAttempt++) {
    await new Promise(r => setTimeout(r, pollInterval));

    try {
      // Query game state via contract read (more reliable than events)
      const [, buyIns, payouts, , hasEndeds] = await publicClient.readContract({
        address: contractAddress,
        abi: GAME_CONTRACT_ABI,
        functionName: 'getEssentialGameInfo',
        args: [[gameId]],
      });

      if (hasEndeds[0]) {
        // Game complete - VRF has resolved
        response.status = 'complete';
        response.result = {
          buy_in_wei: buyIns[0].toString(),
          buy_in_ape: formatEther(buyIns[0]),
          payout_wei: payouts[0].toString(),
          payout_ape: formatEther(payouts[0]),
        };
        break;
      }
    } catch {
      // Polling failed (RPC issue) - continue trying
      // Will eventually timeout if persistent
    }
  }

  return response;
}

// ============================================================================
// RE-EXPORTED UTILITIES
// ============================================================================

/**
 * Re-export commonly used utilities for game handlers
 *
 * This allows game handlers to import everything from base.js
 * instead of importing from multiple modules.
 */
export {
  randomBytes32,      // Generate random 32 bytes for userRandomWord
  randomUint256,      // Generate random uint256 for gameId
  getValidRefAddress, // Validate referral address (returns default team address if invalid)
  formatApeAmount,    // Format APE to 6 decimal places
  sanitizeError,      // Clean error messages for JSON output
};
