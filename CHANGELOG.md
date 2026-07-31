# Changelog

All notable changes to this project will be documented in this file.

## [1.4.0] - 2026-07-31

### Added
- **Dojo Drop** (`dojo-drop`, aliases `dojo`/`drop`/`dd`): cascading slot in the Reel Pirates family, 1-15 spins, 2.5 APE/spin minimum, 0.03 APE/spin executor fee. No bonus buy — the contract's `gameData` has 4 fields (`numSpins`, `gameId`, `ref`, `userRandomWord`), not the 5-field shape used by Blizzard Blitz / GOTG. Cheapest VRF of the cascading slots (`BASE_GAS` 500k, `GAS_PER_RUN` 150k). Contract `0x914d11f805586dF8Ed440Fe23dcdce929965FBb1`.
- Autopilot support for Dojo Drop across all four strategy presets (conservative 10-15 spins, balanced 7-12, aggressive 4-8, degen 1-4).

## [1.3.0] - 2026-05-01

### Added
- **4 new games:**
  - **Reel Pirates** (`reel-pirates`, aliases `pirates`/`reel`): cascading slot, 1-15 spins, 2.5 APE/spin minimum, 0.04 APE/spin executor fee.
  - **Blizzard Blitz** (`blizzard-blitz`, aliases `blizzard`/`blitz`/`bb`): cascading slot with bonus-buy, 1-20 spins, 2.5 APE/spin minimum, 0.04 APE/spin executor fee. Bonus buys cost ≥ 100 APE and force 1 spin.
  - **Gimboz Of The Galaxy** (`gotg`, aliases `gimboz`/`galaxy`): lower-variance cascading slot with bonus-buy, 1-10 spins, 3 APE/spin minimum, 0.05 APE/spin executor fee.
  - **Speed Crash** (`speed-crash`, aliases `crash`/`glyder`/`glyder-crash`): instant-win crash game. Pick a target multiplier (1.01x-10,000x). Surfaces `crash_multiplier` and `hit` in the response so users see where the curve actually crashed.
- **`--bonus-buy` flag** on `play` and `bet` commands for bonus-round purchases. Positional `bonus` keyword also accepted (e.g. `play blizzard-blitz 100 bonus`).
- **`--multiplier` flag** on `play` and `bet` commands for Speed Crash. Accepts decimals or `2.5x` syntax.
- **Per-game `defaultTimeoutMs`** — registry games can declare longer settlement windows. Cascading slots use 60s (vs 30s default) since cascades + bonus rounds settle slower.
- **Executor fee plumbing** — `executeGame` now accepts an optional `executorFee` and adds it to the tx value. Surfaced as `executor_fee_wei` / `executor_fee_ape` in the response.
- **Speed Crash result fields** — completed games include `target_multiplier`, `crash_multiplier`, and `hit` boolean.

### Changed
- **GP token contract migrated** from `0x8046Ac65d2A077562989B2f0770D9bB40e3078CD` to `0x0382338F3876237Ae89317A6a8207C432D430b93` (v2 contract, same ABI). `status` and `send GP` now read/transfer against the new contract. GP held on the v1 contract is no longer surfaced.
- **`selectGameAndConfig` now handles all game types** — autopilot can size params for Speed Keno, Monkey Match, Bear-A-Dice, Reel Pirates, Blizzard Blitz, GOTG, and Speed Crash (previously only the original 6 types were covered; the others fell back to defaults).
- **`play` JSON output spreads the full handler `result`** — game-specific fields (e.g. Speed Crash's `crash_multiplier`) now surface in `--json` output. Existing `won` and `pnl_ape` are still computed and present. New fields (`buy_in_ape`, `buy_in_wei`, `payout_wei`, `vrf_fee_*`, `executor_fee_*`, `total_value_*`) are now visible — additive change, no removals.
- **Human play output** now shows `(crashed at 1.45x)` suffix on win/loss lines whenever a handler surfaces a crash multiplier.

### Internal
- **Consolidated cli.js per-game-type duplication** — replaced ~155 lines of `if (gameEntry.type === ...)` branches in the `play` command with three new dispatcher helpers in `lib/games/index.js`:
  - `parsePositionalArgs(gameEntry, configArgs)` — turns raw CLI args into structured config
  - `resolveGameConfig(gameEntry, opts, positional, existing, strategyConfig, rng)` — applies the standard priority: opts > positional > existing > strategy random
  - `formatGameDescription(gameEntry, gameConfig)` — builds the human-output suffix
  Adding a new game now requires zero `bin/cli.js` changes for normal cases.
- **Standardized config-getter signatures** — all `get<Type>Config` functions now take `(opts, positional, strategyConfig, randomIntInclusive, gameEntry)`. `getPlinkoConfig` updated; `getKenoConfig` and `getSpeedKenoConfig` gained the "infer picks from numbers count" logic that previously only lived in cli.js.
- **`ADDING_GAMES.md` fully rewritten** to reflect the modular `lib/games/<type>.js` architecture (the old version still described the pre-refactor monolithic cli.js flow).

### Notes
- The three cascading-slot handlers (`reelpirates.js`, `blizzardblitz.js`, `gotg.js`) are ~95% identical. If a fourth lands, consider extracting `lib/games/cascadingSlot.js` driven by registry data — `gameEntry.config.spins.minBonusBuyApe` already signals whether the 5-field ABI shape is needed.

## [1.2.15] - 2026-02-05

### Added
- **Transaction Retry for Game Creation**: All game modes now have 1 retry with 2s backoff
  - Blackjack `startGame()` - retry on failure
  - Video Poker `startGame()` - retry on failure
  - Standard `play` command (already had this) - now consistent across all modes

### Changed
- **Loop Mode Resilience**: All `--loop` modes now continue on transient errors
  - Play, Blackjack, and Video Poker loops all use same pattern
  - Track consecutive errors - stop after 3 failures in a row
  - 5-second delay before retrying after error
  - Clear error messages show retry count: `(1/3 consecutive errors)`
  - Prevents single RPC hiccup from breaking long sessions

### Fixed
- Blackjack loop stopping immediately on any game creation error
- Video Poker loop stopping immediately on any game creation error
- Play loop stopping immediately on transaction errors

## [1.2.14] - 2026-02-05

### Added
- **Color Theme System**: Unified semantic color theming via `lib/theme.js`
  - Semantic colors: win/loss, positive/negative, success/error, etc.
  - Formatters: `formatPnL()`, `formatBalance()`, `formatHistoryLine()`, etc.
  - Card colors: Red suits (♥ ♦) vs black suits (♠ ♣)
  - Uses chalk with automatic NO_COLOR support
  - Self-documenting for future commands

### Changed
- **status**: Colored output with semantic styling
- **history**: Games colored by win/loss, improved formatting
- **games**: Game names highlighted, descriptions styled
- **play**: Win/loss results now color-coded with P&L
- **house status**: Yields green, staked amounts blue, profits colored
- Stateful games (blackjack, video-poker) get colored card rendering

### Developer Notes
- New code should import from `lib/theme.js`
- Use semantic colors (`theme.win`, `theme.error`) not raw colors
- Formatters handle sign/color automatically
- Legacy `colorize()` in display.js deprecated but still works

## [1.2.13] - 2026-02-05

### Added
- **Betting Strategies**: Control bet sizing based on win/loss patterns
  - `flat` — Same bet every time (default)
  - `martingale` — Double on loss, reset on win
  - `reverse-martingale` — Double on win, reset on loss
  - `fibonacci` — Fibonacci sequence on losses
  - `dalembert` — +1 unit on loss, -1 on win
  - Use with `--bet-strategy <name>` and `--max-bet <ape>` for safety cap
- **Loop Controls**: Comprehensive automation options
  - `--max-games <n>` — Stop after N games
  - `--target <ape>` — Stop when balance reaches target
  - `--stop-loss <ape>` — Stop when balance drops to limit
  - Works on `play`, `blackjack`, and `video-poker` commands
- **Parameter Validation**: Comprehensive input validation
  - Invalid strategy names show available options
  - Invalid numeric parameters show clear errors
  - Logical validation (stop-loss < target)
  - Balance-aware warnings at loop start
- **Transaction Retry**: Automatic retry on transaction failures
  - 1 retry with 2-second backoff
  - Better error messages for common RPC issues
- **Documentation Overhaul**:
  - Complete SKILL.md rewrite with all games, strategies, patterns
  - New GAMES_REFERENCE.md with detailed syntax for every game
  - Updated README with full feature list

### Changed
- Balance display shows at each loop iteration with session P&L
- Better error messages for rate limits, gas issues, nonce errors
- Blackjack/Video Poker loops now track results for betting strategies

## [1.2.11] - 2026-02-04

### Added
- **Blackjack**: Full interactive blackjack with optimal strategy
  - `apechurch blackjack <amount>` — Interactive play
  - `apechurch blackjack <amount> --auto` — Auto-play with basic strategy
  - `--loop` support for continuous play
  - All actions: hit, stand, double, split, insurance, surrender
  - Resume unfinished games with `blackjack resume`
- **Video Poker**: Jacks or Better with optimal hold strategy
  - `apechurch video-poker <amount>` — Interactive play
  - `apechurch video-poker <amount> --auto` — Auto-play
  - Fixed denominations: 1, 5, 10, 25, 50, 100 APE
  - Progressive jackpot on Royal Flush at max bet
- **Game Clear Commands**: Remove stuck active games
  - `apechurch blackjack clear`
  - `apechurch video-poker clear`

### Fixed
- Windows path handling for `__dirname` (ENOENT double drive letter)

## [1.0.12] - 2026-02-03

### Added
- **ApeStrong game**: Pick-your-odds dice game
  - Choose win probability from 5-95%
  - Lower range = higher payout (e.g., 5% → 19.5x, 50% → 1.95x)
  - `apechurch play ape-strong 10 50`
  - Aliases: `strong`, `dice`, `limbo`
  - Strategy support with persona-based range selection
- **Keno**: Classic keno with 1-10 picks from 1-40
- **Speed Keno**: Fast batched keno, 1-5 picks from 1-20
- **Monkey Match**: Poker hands from barrel monkeys
- **Bear-A-Dice**: Avoid unlucky dice rolls

## [1.0.2] - 2026-02-03

### Added
- **Pause/Resume commands**: Control autonomous play
  - `apechurch pause` — stops heartbeat from playing
  - `apechurch resume` — allows heartbeat to play again
- **Balance check in bet command**: Prevents play if balance ≤ 1 APE

### Changed
- **Error handling polish**: All errors return clean JSON
  - No stack traces leaked
  - Common RPC/network errors have friendly messages

## [1.0.1] - 2026-02-03

### Changed
- **Faster cooldowns**: Reduced from minutes to seconds
- **Username flexibility**: Any username up to 32 chars
- **Clearer install output**: Shows when username was auto-generated

## [1.0.0] - 2026-02-03

### Added
- Initial release
- Core games: Jungle Plinko, Dino Dough, Bubblegum Heist, Roulette, Baccarat
- Wallet management with optional encryption
- Loop mode with `--loop` flag
- Strategy presets: conservative, balanced, aggressive, degen
- JSON output for all commands
- SIWE-based username registration
