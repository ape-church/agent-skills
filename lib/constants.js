/**
 * @fileoverview Constants and configuration for Ape Church CLI
 *
 * This module centralizes all static configuration:
 * - Chain definitions (ApeChain mainnet)
 * - File paths for local data storage
 * - API endpoints for profile/username registration
 * - Contract addresses and ABIs for on-chain interactions
 * - Game configuration defaults
 *
 * @module lib/constants
 */
import os from 'os';
import path from 'path';
import { defineChain } from 'viem';

// ============================================================================
// CHAIN CONFIGURATION
// ============================================================================

/**
 * ApeChain mainnet configuration for viem
 *
 * ApeChain is an L3 built on Arbitrum, using APE as native gas token.
 * Chain ID 33139 is the mainnet identifier.
 *
 * @type {import('viem').Chain}
 */
export const apechain = defineChain({
  id: 33139,
  name: 'ApeChain',
  nativeCurrency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.apechain.com/http'] },
  },
  blockExplorers: {
    default: { name: 'ApeScan', url: 'https://apescan.io' },
  },
});

// ============================================================================
// FILE PATHS
// ============================================================================

/**
 * User's home directory (platform-independent)
 * @type {string}
 */
export const HOME = os.homedir();

/**
 * Root directory for all Ape Church CLI data
 * Default: ~/.apechurch/
 * @type {string}
 */
export const APECHURCH_DIR = path.join(HOME, '.apechurch');

/**
 * Directory for skill files (SKILL.md, etc.) when installed for agent frameworks
 * @type {string}
 */
export const SKILL_TARGET_DIR = path.join(APECHURCH_DIR, 'skill');

/**
 * Wallet storage file - contains private key (encrypted or plaintext)
 * CRITICAL: This file holds funds. Never delete without user confirmation.
 * @type {string}
 */
export const WALLET_FILE = path.join(APECHURCH_DIR, 'wallet.json');

/**
 * Session state file - tracks wins, losses, streaks, betting state
 * Used for betting strategy calculations and session statistics
 * @type {string}
 */
export const STATE_FILE = path.join(APECHURCH_DIR, 'state.json');

/**
 * Profile file - user preferences, persona, username, referral address
 * @type {string}
 */
export const PROFILE_FILE = path.join(APECHURCH_DIR, 'profile.json');

/**
 * Game history file - last N games played with outcomes
 * Limited to 1000 entries to prevent unbounded growth
 * @type {string}
 */
export const HISTORY_FILE = path.join(APECHURCH_DIR, 'history.json');

/**
 * Active games file - tracks in-progress multi-step games (Blackjack, Video Poker)
 * Used for resuming interrupted games
 * @type {string}
 */
export const ACTIVE_GAMES_FILE = path.join(APECHURCH_DIR, 'active_games.json');

// ============================================================================
// API CONFIGURATION
// ============================================================================

/**
 * Profile API endpoint for username registration and lookup
 * Can be overridden via APECHURCH_PROFILE_URL environment variable
 * @type {string}
 */
export const PROFILE_API_URL = process.env.APECHURCH_PROFILE_URL || 'https://www.ape.church/api/profile';

/**
 * SIWE (Sign-In With Ethereum) domain for authentication
 * Must match the domain in the SIWE message
 * @type {string}
 */
export const SIWE_DOMAIN = 'ape.church';

/**
 * SIWE URI for authentication messages
 * @type {string}
 */
export const SIWE_URI = 'https://ape.church';

/**
 * Chain ID used in SIWE messages (ApeChain mainnet)
 * @type {number}
 */
export const SIWE_CHAIN_ID = 33139;

// ============================================================================
// GAME CONFIGURATION
// ============================================================================

/**
 * Minimum APE to keep in wallet for gas fees
 * Play commands will refuse to bet if balance would drop below this
 * @type {number}
 */
export const GAS_RESERVE_APE = 1;

/**
 * Default delay between games in loop mode (milliseconds)
 * Prevents rate limiting and gives VRF time to settle
 * @type {number}
 */
export const DEFAULT_COOLDOWN_MS = 30 * 1000; // 30 seconds

/**
 * Ethereum zero address - used for "no referral" in game calls
 * @type {string}
 */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ============================================================================
// TOKEN CONFIGURATION
// ============================================================================

/**
 * GP (Gimbo Points) token contract address
 * GP is the reward/cashback token earned from playing games.
 *
 * Note: This is the v2 contract (relaunched). The original v1 contract at
 * 0x8046Ac65d2A077562989B2f0770D9bB40e3078CD is deprecated — any GP held
 * there will not appear in `status` or be sendable via this CLI.
 * @type {string}
 */
export const GP_TOKEN_CONTRACT = '0x0382338F3876237Ae89317A6a8207C432D430b93';

/**
 * GP token decimals - GP uses 0 decimals (whole numbers only)
 * This is unusual for ERC20 tokens (most use 18)
 * @type {number}
 */
export const GP_DECIMALS = 0;

// ============================================================================
// THE HOUSE CONFIGURATION
// ============================================================================

/**
 * The House contract address - decentralized bankroll pool
 * Depositors become "the house" and earn/lose based on player outcomes
 * @type {string}
 */
export const HOUSE_CONTRACT = '0x2054709F89F18a4CCAC6132acE7b812E32608469';

/**
 * Lock time after depositing to The House (seconds)
 * Prevents flash-loan style attacks on the bankroll
 * @type {number}
 */
export const HOUSE_LOCK_TIME = 15 * 60; // 15 minutes

/**
 * Withdrawal fee from The House (as decimal)
 * Discourages frequent withdrawals and funds the protocol
 * @type {number}
 */
export const HOUSE_WITHDRAW_FEE = 0.02; // 2%

// ============================================================================
// CONTEST CONFIGURATION
// ============================================================================

/**
 * Contest registration contract address
 * Players pay entry fee here to join competitions
 * @type {string}
 */
export const CONTEST_REGISTER_CONTRACT = '0xd4de892BA1DD88b2EB4DF588c80f1c8E1428fe4b';

/**
 * User info contract - tracks total wagered per address
 * Used for contest eligibility verification
 * @type {string}
 */
export const USER_INFO_CONTRACT = '0x6EA76F01Aa615112AB7de1409EFBD80a13BfCC84';

/**
 * Contest entry fee in APE
 * @type {number}
 */
export const CONTEST_ENTRY_FEE = 5;

/**
 * Maximum total wager to remain eligible for contest
 * Prevents whales from dominating by volume
 * @type {number}
 */
export const CONTEST_WAGER_LIMIT = 1000;

/**
 * Contest end date - after this, registration closes
 * @type {Date}
 */
export const CONTEST_END_DATE = new Date('2026-04-01T00:00:00Z');

// ============================================================================
// CONTRACT ABIs
// ============================================================================

/**
 * Standard game contract ABI
 *
 * All Ape Church games implement this interface:
 * - play(address, bytes): Start a game with encoded parameters
 * - GameEnded event: Emitted when VRF resolves and game completes
 * - getEssentialGameInfo: Batch query for game history
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const GAME_CONTRACT_ABI = [
  {
    type: 'function',
    name: 'play',
    stateMutability: 'payable',
    inputs: [
      { name: 'player', type: 'address' },
      { name: 'gameData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'GameEnded',
    anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'gameId', type: 'uint256', indexed: false },
      { name: 'buyIn', type: 'uint256', indexed: false },
      { name: 'payout', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getEssentialGameInfo',
    stateMutability: 'view',
    inputs: [{ name: 'gameIds', type: 'uint256[]' }],
    outputs: [
      { name: 'players', type: 'address[]' },
      { name: 'buyInAmounts', type: 'uint256[]' },
      { name: 'totalPayouts', type: 'uint256[]' },
      { name: 'timestamps', type: 'uint256[]' },
      { name: 'hasEndeds', type: 'bool[]' },
    ],
  },
];

/**
 * Plinko-style VRF fee ABI
 *
 * Plinko games have variable gas costs based on number of balls dropped.
 * Each ball requires additional VRF randomness, so gas scales linearly.
 *
 * Formula: baseGas + (balls * perUnitGas)
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const PLINKO_VRF_ABI = [
  {
    type: 'function',
    name: 'getVRFFee',
    stateMutability: 'view',
    inputs: [{ name: 'customGasLimit', type: 'uint32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

/**
 * Slots-style VRF fee ABI
 *
 * Simple games with fixed VRF cost - one random number per game.
 * Used by: Roulette, Baccarat, ApeStrong, Keno, etc.
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const SLOTS_VRF_ABI = [
  {
    type: 'function',
    name: 'getVRFFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

/**
 * Contest registration contract ABI
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const REGISTER_AGENT_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

/**
 * User info contract ABI - for querying total wagered
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const USER_INFO_ABI = [
  {
    type: 'function',
    name: 'getTotalWagered',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

/**
 * The House contract ABI
 *
 * The House is a shared liquidity pool that backs all games.
 * Depositors receive HOUSE tokens representing their share.
 *
 * Key mechanics:
 * - deposit(): Add APE, receive HOUSE tokens at current price
 * - withdraw(): Burn HOUSE tokens, receive APE minus 2% fee
 * - 15-minute lock after deposit prevents flash-loan attacks
 * - Price fluctuates based on player wins/losses
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const HOUSE_ABI = [
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxPayout',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'timeUntilUnlock',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'calculatePrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTotalProfits',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'int256' }],
  },
];

/**
 * GP Token ABI (Gimbo Points)
 *
 * GP is a non-standard ERC20 with 0 decimals (whole numbers only).
 * Earned as cashback/rewards for playing games.
 * Can be transferred or used to purchase NFTs.
 *
 * Note: Uses getCurrentEXP instead of standard balanceOf for some queries.
 *
 * @type {Array<import('viem').AbiItem>}
 */
export const GP_TOKEN_ABI = [
  {
    type: 'function',
    name: 'getCurrentEXP',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];
