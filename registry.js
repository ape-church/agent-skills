/**
 * @fileoverview Game Registry for Ape Church CLI
 *
 * Central registry of all supported games with:
 * - Contract addresses
 * - Game configuration (parameters, limits)
 * - VRF (Verifiable Random Function) settings
 * - Aliases for easy CLI access
 * - Multiplier/payout information
 *
 * Adding a New Game:
 * 1. Add entry to GAME_REGISTRY array
 * 2. Implement game handler in lib/games/<type>.js
 * 3. Register handler in lib/games/index.js
 * 4. See ADDING_GAMES.md for full guide
 *
 * @module registry
 */

// ============================================================================
// GAME REGISTRY
// ============================================================================

/**
 * Master list of all supported games
 *
 * Each game entry contains:
 * - key: Unique identifier (used in CLI and storage)
 * - name: Human-readable name
 * - slug: URL-safe identifier (matches ape.church URLs)
 * - type: Game type for handler routing (plinko, slots, roulette, etc.)
 * - description: User-facing description
 * - contract: On-chain contract address
 * - aliases: Alternative names for CLI (e.g., 'plinko' → 'jungle-plinko')
 * - config: Game-specific parameters and their limits
 * - vrf: VRF fee calculation settings
 * - multipliers: Payout multipliers (where applicable)
 *
 * @type {Array<Object>}
 */
export const GAME_REGISTRY = [
  // ===========================================================================
  // KENO - Pick numbers, match draws
  // ===========================================================================
  {
    key: 'keno',
    name: 'Keno',
    slug: 'keno',
    type: 'keno',
    description: 'Pick 1-10 numbers from 1-40. More picks = riskier but bigger payouts. Hit 10/10 for up to 1,000,000x!',
    contract: '0xc936D6691737afe5240975622f0597fA2d122FAd',
    aliases: ['k'],
    config: {
      picks: {
        min: 1,
        max: 10,
        default: 5,
        description: 'How many numbers to pick (1-10). More picks = higher risk/reward.',
      },
      numbers: {
        description: 'Which numbers to bet on (1-40). If not specified, random picks are used.',
        examples: ['1,7,13,25,40', '5,10,15,20,25,30,35,40', 'random'],
      },
    },
    vrf: {
      type: 'static', // Uses getVRFFee() with no args
    },
  },

  // ===========================================================================
  // APESTRONG - Pick-your-odds dice game
  // ===========================================================================
  {
    key: 'ape-strong',
    name: 'ApeStrong',
    slug: 'ape-strong',
    type: 'apestrong',
    description: 'Pick your odds! Choose a range (5-95) — roll under to win. Higher range = more likely to win, lower payout.',
    contract: '0x0717330c1a9e269a0e034aBB101c8d32Ac0e9600',
    aliases: ['strong', 'dice', 'limbo'],
    config: {
      range: {
        min: 5,
        max: 95,
        default: 50,
        description: 'Win probability (%). Roll under this number to win. Lower = riskier, bigger payout.',
        examples: [
          { value: 50, payout: '1.95x', winChance: '50%' },
          { value: 25, payout: '3.9x', winChance: '25%' },
          { value: 75, payout: '1.3x', winChance: '75%' },
          { value: 5, payout: '19.5x', winChance: '5%' },
          { value: 95, payout: '1.025x', winChance: '95%' },
        ],
      },
    },
    vrf: {
      type: 'static',
    },
  },

  // ===========================================================================
  // BACCARAT - Classic casino game
  // ===========================================================================
  {
    key: 'baccarat',
    name: 'Baccarat',
    slug: 'baccarat',
    type: 'baccarat',
    description: 'Classic baccarat. Bet on Player (2x), Banker (1.95x), or Tie (9x).',
    contract: '0xB08C669dc0419151bA4e4920E80128802dB5497b',
    aliases: ['bacc'],
    config: {
      bet: {
        description: 'What to bet on: PLAYER, BANKER, TIE. For combined bets, specify amounts explicitly.',
        examples: ['PLAYER', 'BANKER', 'TIE', '140 BANKER 10 TIE', '180 PLAYER 20 TIE'],
      },
    },
    // Payout multipliers (includes house edge)
    multipliers: {
      player: 2.0,    // Even money
      banker: 1.95,   // 5% commission on banker wins
      tie: 9.0,       // High payout but rare (~9.5% probability)
    },
    vrf: {
      type: 'static',
    },
  },

  // ===========================================================================
  // ROULETTE - American roulette with 0 and 00
  // ===========================================================================
  {
    key: 'roulette',
    name: 'Roulette',
    slug: 'roulette',
    type: 'roulette',
    description: 'Classic roulette with American layout (0, 00, 1-36). Bet on numbers, colors, or sections.',
    contract: '0x1f48A104C1808eb4107f3999999D36aeafEC56d5',
    aliases: ['rl'],
    config: {
      bet: {
        description: 'What to bet on. Numbers (0-36, 00), colors (RED, BLACK), parity (ODD, EVEN), sections, etc.',
        examples: ['RED', 'BLACK', '17', '0', '00', 'RED,BLACK', 'FIRST_THIRD', 'ODD'],
      },
    },
    /**
     * Bet type mappings: user input → on-chain bet type value
     *
     * The contract uses numeric bet types:
     * - 1 = Zero (0)
     * - 2-37 = Numbers 1-36
     * - 38 = Double Zero (00)
     * - 39-50 = Outside bets (thirds, columns, colors, etc.)
     */
    betTypes: {
      '0': 1,                // Zero
      '00': 38,              // Double Zero (American roulette)
      // Numbers 1-36 map to 2-37 (handled dynamically in encoder)
      'FIRST_THIRD': 39,     // 1-12
      'SECOND_THIRD': 40,    // 13-24
      'THIRD_THIRD': 41,     // 25-36
      'FIRST_COL': 42,       // Column 1 (1,4,7,10,...)
      'FIRST_COLUMN': 42,
      'SECOND_COL': 43,      // Column 2 (2,5,8,11,...)
      'SECOND_COLUMN': 43,
      'THIRD_COL': 44,       // Column 3 (3,6,9,12,...)
      'THIRD_COLUMN': 44,
      'FIRST_HALF': 45,      // 1-18
      'SECOND_HALF': 46,     // 19-36
      'EVEN': 47,
      'ODD': 48,
      'BLACK': 49,
      'RED': 50,
    },
    // Approximate multipliers (with house edge)
    multipliers: {
      number: 36.9,   // Single number (including 0, 00) - true odds would be 38:1
      color: 2.05,    // RED, BLACK
      parity: 2.05,   // ODD, EVEN
      half: 2.05,     // FIRST_HALF, SECOND_HALF
      third: 3.075,   // FIRST_THIRD, SECOND_THIRD, THIRD_THIRD
      column: 3.075,  // FIRST_COL, SECOND_COL, THIRD_COL
    },
    vrf: {
      type: 'static',
    },
  },

  // ===========================================================================
  // JUNGLE PLINKO - Ball-drop game with multiplier buckets
  // ===========================================================================
  {
    key: 'jungle-plinko',
    name: 'Jungle Plinko',
    slug: 'jungle-plinko',
    type: 'plinko',
    description: 'Drop balls through pegs into multiplier buckets. Higher modes = bigger risk & reward.',
    contract: '0x88683B2F9E765E5b1eC2745178354C70A03531Ce',
    aliases: ['plinko'],
    config: {
      mode: {
        min: 0,
        max: 4,
        default: 2,
        description: 'Risk level - higher = more volatile multipliers',
        options: [
          { value: 0, label: 'Safe', desc: 'Tight multiplier range, consistent returns' },
          { value: 1, label: 'Low', desc: 'Slightly wider range, small upside' },
          { value: 2, label: 'Medium', desc: 'Balanced risk/reward (recommended)' },
          { value: 3, label: 'High', desc: 'Wide multiplier swings, big potential' },
          { value: 4, label: 'Extreme', desc: 'Max volatility, moonshot multipliers' },
        ],
      },
      balls: {
        min: 1,
        max: 100,
        default: 50,
        description: 'Number of balls to drop. Wager is split across all balls. More balls = smoother variance.',
      },
    },
    /**
     * VRF fee calculation for Plinko
     *
     * Plinko needs more gas per ball (each ball = additional randomness).
     * Formula: getVRFFee(baseGas + balls * perUnitGas)
     */
    vrf: {
      type: 'plinko',
      baseGas: 289000,    // Base gas for transaction
      perUnitGas: 11000,  // Additional gas per ball
    },
  },

  // ===========================================================================
  // DINO DOUGH - Dinosaur-themed slot machine
  // ===========================================================================
  {
    key: 'dino-dough',
    name: 'Dino Dough',
    slug: 'dino-dough',
    type: 'slots',
    description: 'Dinosaur-themed slot machine. Spin for matching symbols and multipliers.',
    contract: '0x9ebb4Df257B971582BAf096b62CA41DE7723F3CB',
    aliases: ['dino', 'slots'],
    config: {
      spins: {
        min: 1,
        max: 15,
        default: 10,
        description: 'Number of spins per bet. Wager is split across all spins. More spins = smoother variance.',
      },
    },
    vrf: {
      type: 'slots', // Uses getVRFFee() with no args
    },
  },

  // ===========================================================================
  // BUBBLEGUM HEIST - Candy-themed slot machine
  // ===========================================================================
  {
    key: 'bubblegum-heist',
    name: 'Bubblegum Heist',
    slug: 'bubblegum-heist',
    type: 'slots',
    description: 'Candy-themed slot machine. Spin for sweet multipliers and jackpots.',
    contract: '0xB5Da735118e848130B92994Ee16377dB2AE31a4c',
    aliases: ['bubblegum', 'heist'],
    config: {
      spins: {
        min: 1,
        max: 15,
        default: 10,
        description: 'Number of spins per bet. Wager is split across all spins. More spins = smoother variance.',
      },
    },
    vrf: {
      type: 'slots',
    },
  },

  // ===========================================================================
  // SPEED KENO - Fast batched keno variant
  // ===========================================================================
  {
    key: 'speed-keno',
    name: 'Speed Keno',
    slug: 'speed-keno',
    type: 'speedkeno',
    description: 'Fast keno with batching! Pick 1-5 numbers from 1-20. Batch up to 20 games. Hit 5/5 for 2000x!',
    contract: '0x40EE3295035901e5Fd80703774E5A9FE7CE2B90C',
    aliases: ['sk', 'speedk'],
    config: {
      picks: {
        min: 1,
        max: 5,
        default: 3,
        description: 'How many numbers to pick (1-5). More picks = higher risk/reward.',
      },
      numbers: {
        description: 'Which numbers to bet on (1-20). If not specified, random picks are used.',
        examples: ['1,7,13', '5,10,15,18,20', 'random'],
      },
      games: {
        min: 1,
        max: 20,
        default: 5,
        description: 'Number of games to batch (1-20). Wager is split across all games.',
      },
    },
    // Perfect match multipliers
    multipliers: {
      '5/5': 2000,
      '4/4': 100,
      '3/3': 20,
      '2/2': 4,
      '1/1': 2,
    },
    /**
     * VRF fee calculation for Speed Keno
     *
     * More games = more randomness needed
     * Formula: getVRFFee(baseGas + games * perUnitGas)
     */
    vrf: {
      type: 'speedkeno',
      baseGas: 325000,
      perUnitGas: 55000,
    },
  },

  // ===========================================================================
  // MONKEY MATCH - Poker hands from barrels
  // ===========================================================================
  {
    key: 'monkey-match',
    name: 'Monkey Match',
    slug: 'monkey-match',
    type: 'monkeymatch',
    description: 'Monkeys pop from 5 barrels — form poker hands! Five of a Kind = 50x. Low Risk has 6 monkeys, Normal has 7.',
    contract: '0x59EBd3406b76DCc74102AFa2cA5284E9AAB6bA28',
    aliases: ['monkey', 'mm'],
    config: {
      mode: {
        min: 1,
        max: 2,
        default: 1,
        description: 'Risk level. 1=Low Risk (6 monkeys, easier matches), 2=Normal Risk (7 monkeys, better mid payouts).',
        options: [
          { value: 1, label: 'Low Risk', desc: '6 monkey types — easier to match' },
          { value: 2, label: 'Normal Risk', desc: '7 monkey types — better mid-tier payouts' },
        ],
      },
    },
    vrf: {
      type: 'static',
    },
  },

  // ===========================================================================
  // REEL PIRATES - Cascading slot with bonus rounds
  // ===========================================================================
  {
    key: 'reel-pirates',
    name: 'Reel Pirates',
    slug: 'reel-pirates',
    type: 'reelpirates',
    description: 'Cascading slot engine with a 5-free-spin bonus round. Cascades give near-infinite payout potential — high variance.',
    contract: '0x5E405198B349d6522BbB614E7391bDC4F4F6f681',
    aliases: ['pirates', 'reel'],
    config: {
      spins: {
        min: 1,
        max: 15,
        default: 10,
        // Per-spin minimum is enforced on-chain. We mirror it here so the CLI
        // can fail fast and so help text can show it.
        minBetPerSpinApe: 2.5,
        // Per-spin executor fee — paid on top of wager + VRF fee, sent in the
        // tx value. Incentivizes bots that process the cascading game math.
        executorFeePerSpinApe: 0.04,
        description: 'Number of spins per bet (1-15). Wager is split across all spins. Minimum 2.5 APE per spin (e.g. 10 spins = 25 APE minimum). Plus 0.04 APE/spin executor fee.',
      },
    },
    /**
     * VRF fee calculation for Reel Pirates
     *
     * Cascades + bonus rounds need extra gas per spin.
     * Formula: getVRFFee(baseGas + spins * perUnitGas)
     */
    vrf: {
      type: 'reelpirates',
      baseGas: 550000,
      perUnitGas: 200000,
    },
    // Cascades + bonus rounds settle slower than typical games. Wait longer
    // before falling back to "pending" status. The CLI reads this if set.
    defaultTimeoutMs: 60000,
  },

  // ===========================================================================
  // BLIZZARD BLITZ - Cascading slot with bonus-buy option
  // ===========================================================================
  {
    key: 'blizzard-blitz',
    name: 'Blizzard Blitz',
    slug: 'blizzard-blitz',
    type: 'blizzardblitz',
    description: 'Cascading slot like Reel Pirates, plus the ability to BUY into the bonus round directly. Higher variance, higher ceiling.',
    contract: '0x64b27c1c69559A795C98958614398dD7195AE1B8',
    aliases: ['blizzard', 'blitz', 'bb'],
    config: {
      spins: {
        min: 1,
        max: 20,
        default: 10,
        // Per-spin minimum is enforced on-chain. We mirror it here so the CLI
        // can fail fast and so help text can show it.
        minBetPerSpinApe: 2.5,
        // Bonus-buy mode: contract requires numSpins == 1 and a flat APE floor.
        // The bonus-buy effectively divides your bet by 32x for the underlying
        // spin math, so the floor is much higher than the per-spin minimum.
        minBonusBuyApe: 100,
        // Per-spin executor fee — paid on top of wager + VRF fee, sent in the
        // tx value. Incentivizes bots that process the cascading game math.
        // Bonus buys count as 1 spin, so 0.04 APE.
        executorFeePerSpinApe: 0.04,
        description: 'Number of spins per bet (1-20). Wager is split across all spins. Minimum 2.5 APE per spin. Bonus buy: --bonus-buy (or positional "bonus") with ≥ 100 APE. Plus 0.04 APE/spin executor fee.',
      },
    },
    /**
     * VRF fee calculation for Blizzard Blitz
     *
     * Same shape as Reel Pirates — cascades + bonus rounds need extra gas.
     * Formula: getVRFFee(baseGas + spins * perUnitGas)
     */
    vrf: {
      type: 'blizzardblitz',
      baseGas: 550000,
      perUnitGas: 200000,
    },
    // Cascades + bonus rounds settle slower than typical games.
    defaultTimeoutMs: 60000,
  },

  // ===========================================================================
  // GIMBOZ OF THE GALAXY - Cascading slot, lower variance than the others
  // ===========================================================================
  {
    key: 'gotg',
    name: 'Gimboz Of The Galaxy',
    slug: 'gotg',
    type: 'gotg',
    description: 'Cascading slot with bonus-buy. Lower variance than Reel Pirates / Blizzard Blitz — capped at 10 spins, higher per-spin minimum.',
    contract: '0x1AC78E6a153DeEd1b8dB67b9813991651D53E3a6',
    aliases: ['gimboz', 'galaxy'],
    config: {
      spins: {
        min: 1,
        max: 10,
        default: 5,
        // Per-spin minimum is enforced on-chain. Higher than the other two
        // cascading slots (3 APE vs 2.5).
        minBetPerSpinApe: 3,
        // Bonus-buy: contract requires numSpins == 1 and a flat APE floor.
        // The bonus-buy effectively divides your bet by 32x for the underlying
        // spin math, so the floor is much higher than the per-spin minimum.
        minBonusBuyApe: 100,
        // Per-spin executor fee — paid on top of wager + VRF fee, sent in the
        // tx value. Higher than the other cascading slots (0.05 APE vs 0.04).
        executorFeePerSpinApe: 0.05,
        description: 'Number of spins per bet (1-10). Wager is split across all spins. Minimum 3 APE per spin (e.g. 10 spins = 30 APE minimum). Bonus buy: --bonus-buy with ≥ 100 APE. Plus 0.05 APE/spin executor fee.',
      },
    },
    /**
     * VRF fee calculation for Gimboz Of The Galaxy
     *
     * Same formula as Reel Pirates / Blizzard Blitz.
     */
    vrf: {
      type: 'gotg',
      baseGas: 550000,
      perUnitGas: 200000,
    },
    // Cascades + bonus rounds settle slower than typical games.
    defaultTimeoutMs: 60000,
  },

  // ===========================================================================
  // SPEED CRASH - Crash game (pick multiplier, hope curve hits it)
  // ===========================================================================
  {
    key: 'speed-crash',
    name: 'Speed Crash',
    slug: 'speed-crash',
    type: 'speedcrash',
    description: 'Crash game — pick a target multiplier (1.01x to 10,000x). Cash out at your target before the curve crashes. Higher target = lower hit chance, bigger payout.',
    contract: '0x5B44Ce34300D1b8d32b5A6119f192e3edA74e144',
    aliases: ['crash', 'glyder', 'glyder-crash'],
    config: {
      multiplier: {
        min: 1.01,
        max: 10000,
        default: 2,
        description: 'Target cash-out multiplier. Stored on-chain scaled by 10,000 (e.g. 2.5 → 25000). Min 1.01x, max 10,000x.',
        examples: [
          { value: 1.5, hitChance: '~66%', desc: 'Frequent small wins' },
          { value: 2, hitChance: '~50%', desc: 'Even-money territory' },
          { value: 5, hitChance: '~20%', desc: 'Higher variance' },
          { value: 10, hitChance: '~10%', desc: 'High risk, high reward' },
          { value: 100, hitChance: '~1%', desc: 'Lottery mode' },
        ],
      },
    },
    vrf: { type: 'static' },
  },

  // ===========================================================================
  // BEAR-A-DICE - Avoid unlucky dice rolls
  // ===========================================================================
  {
    key: 'bear-dice',
    name: 'Bear-A-Dice',
    slug: 'bear-dice',
    type: 'beardice',
    description: 'Roll 2 dice up to 5 times. Avoid unlucky numbers! Easy mode: dodge 7s. Higher modes = more danger.',
    contract: '0x6a48A513A46955D8622C809Fce876d2f11142003',
    aliases: ['bear', 'dice', 'bd'],
    config: {
      difficulty: {
        min: 0,
        max: 4,
        default: 0,
        description: 'Difficulty level. Higher = more losing numbers. Stick to 0 for auto-play!',
        options: [
          { value: 0, label: 'Easy', desc: 'Lose on 7 — safest mode' },
          { value: 1, label: 'Normal', desc: 'Lose on 6,7,8 — risky' },
          { value: 2, label: 'Hard', desc: 'Lose on 5,6,7,8,9 — very risky!' },
          { value: 3, label: 'Extreme', desc: 'Lose on 4,5,6,7,8,9,10 — brutal' },
          { value: 4, label: 'Master', desc: 'Lose on 3-11 — only 2 or 12 wins!' },
        ],
      },
      rolls: {
        min: 1,
        max: 5,
        default: 1,
        description: 'Number of dice rolls (1-5). More rolls = higher payout but more chances to lose.',
      },
    },
    /**
     * VRF fee calculation for Bear-A-Dice
     *
     * More rolls = more randomness
     */
    vrf: {
      type: 'beardice',
      baseGas: 500000,
      perUnitGas: 100000,
    },
  },
];

// ============================================================================
// GAME INDEX (Fast Lookup)
// ============================================================================

/**
 * Map for O(1) game lookup by key or alias
 *
 * Populated at module load time from GAME_REGISTRY.
 * Maps both primary keys and aliases to game entries.
 *
 * @type {Map<string, Object>}
 */
const GAME_INDEX = new Map();

// Build index from registry
for (const game of GAME_REGISTRY) {
  // Index by primary key
  GAME_INDEX.set(game.key, game);

  // Index by all aliases
  if (Array.isArray(game.aliases)) {
    for (const alias of game.aliases) {
      GAME_INDEX.set(alias, game);
    }
  }
}

// ============================================================================
// LOOKUP FUNCTIONS
// ============================================================================

/**
 * Resolve a game by key or alias
 *
 * Case-insensitive lookup that works with primary keys and aliases.
 *
 * @param {string|null} input - Game key, alias, or null
 * @returns {Object|null} Game entry object, or null if not found
 *
 * @example
 * resolveGame('plinko')      // Returns jungle-plinko entry
 * resolveGame('jungle-plinko') // Returns jungle-plinko entry
 * resolveGame('ROULETTE')    // Returns roulette entry (case-insensitive)
 * resolveGame('invalid')     // Returns null
 */
export function resolveGame(input) {
  if (!input) return null;
  const key = String(input).toLowerCase();
  return GAME_INDEX.get(key) || null;
}

/**
 * List all available game keys
 *
 * Returns primary keys only (not aliases).
 * Useful for help text and validation.
 *
 * @returns {string[]} Array of game keys
 *
 * @example
 * listGames()
 * // ['keno', 'ape-strong', 'baccarat', 'roulette', 'jungle-plinko', ...]
 */
export function listGames() {
  return GAME_REGISTRY.map((game) => game.key);
}
