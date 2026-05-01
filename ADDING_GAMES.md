# Adding Games to the Ape Church CLI

This is the practical guide for adding a new single-transaction game (Roulette, Plinko, ApeStrong, etc.) to the `apechurch` CLI.

For multi-step games (Blackjack, Video Poker — anything with mid-game decisions), see [Stateful Games](#stateful-games-blackjack--video-poker) at the bottom; they live under a different module and don't follow this flow.

---

## Architecture in 30 seconds

```
registry.js                  ← declarative game definitions (contract, type, params, VRF)
lib/games/<type>.js          ← one module per game type — encodes call, gets VRF fee, returns result
lib/games/base.js            ← shared: getStaticVrfFee / getPlinkoVrfFee, executeGame (tx + retry + poll)
lib/games/index.js           ← gameHandlers + configGetters maps + dispatcher helpers
lib/strategy.js              ← getStrategyConfig() presets, selectGameAndConfig() for autopilot
bin/cli.js                   ← play command imports the dispatcher helpers and stays game-agnostic
```

The `play` command never branches on game type. It calls three helpers from `lib/games/index.js`:

| Helper | What it does |
|---|---|
| `parsePositionalArgs(gameEntry, configArgs)` | Turns raw CLI args into a structured `positionalConfig` |
| `resolveGameConfig(gameEntry, opts, positional, existing, strategyConfig, rng)` | Picks the right per-type getter and applies priority `opts > positional > existing > strategy` |
| `formatGameDescription(gameEntry, gameConfig)` | Builds the suffix shown in human output (e.g. `" — RED"`) |

So when you add a new game, the only files that need to change are `registry.js`, `lib/games/<type>.js`, `lib/games/index.js` (one line in each map + one switch case in two helpers), and optionally `lib/strategy.js` if it should appear in autopilot.

---

## Step-by-step: adding a new single-tx game

Worked example: imagine adding a game called "Banana Roulette" (`type: 'bananaroulette'`) where the player picks a target slot 1–8 and bets on hitting it.

### 1. Add the game to `registry.js`

```js
{
  key: 'banana-roulette',           // CLI key — what `play <key>` accepts
  name: 'Banana Roulette',          // Display name
  slug: 'banana-roulette',          // URL slug — must match ape.church/games/<slug>
  type: 'bananaroulette',           // Game type — drives handler routing (see step 2)
  description: 'Pick 1-8, hit it for 7x. Drop a banana, see what happens.',
  contract: '0xYOUR_CONTRACT_ADDRESS_HERE',
  aliases: ['br', 'banana'],

  // Parameters surfaced in `apechurch game banana-roulette`:
  config: {
    slot: {
      min: 1,
      max: 8,
      default: 1,
      description: 'Which slot to bet on (1-8). All slots have equal odds.',
    },
  },

  // Static = getVRFFee() with no args. Use 'plinko' shape (with baseGas + perUnitGas)
  // if VRF cost scales with a parameter (number of balls, rolls, batched games, etc.)
  vrf: { type: 'static' },
}
```

### 2. Create the handler at `lib/games/bananaroulette.js`

Two exports: a `play*` function that builds the call and a `get*Config` function that the dispatcher uses to resolve params.

```js
import { encodeAbiParameters } from 'viem';
import { ensureIntRange } from '../utils.js';
import {
  getStaticVrfFee,
  executeGame,
  randomBytes32,
  randomUint256,
  getValidRefAddress,
} from './base.js';

export async function playBananaRoulette({
  account,
  publicClient,
  walletClient,
  gameEntry,
  wager,
  slot,
  referral,
  timeoutMs,
}) {
  const refAddress = getValidRefAddress(referral);
  const gameId = randomUint256();
  const userRandomWord = randomBytes32();

  const slotValue = ensureIntRange(
    slot ?? gameEntry.config.slot.default,
    'slot',
    gameEntry.config.slot.min,
    gameEntry.config.slot.max,
  );

  const vrfFee = await getStaticVrfFee(publicClient, gameEntry.contract);

  // Must match the contract's `gameData` decode order EXACTLY.
  const encodedData = encodeAbiParameters(
    [
      { name: 'slot', type: 'uint8' },
      { name: 'gameId', type: 'uint256' },
      { name: 'ref', type: 'address' },
      { name: 'userRandomWord', type: 'bytes32' },
    ],
    [slotValue, gameId, refAddress, userRandomWord],
  );

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
    config: { slot: slotValue },
    timeoutMs,
  });
}

// Standard getter signature: (opts, positional, strategyConfig, randomIntInclusive, gameEntry)
// All five args are passed by the dispatcher. Trailing args you don't need are fine to ignore.
export function getBananaRouletteConfig(opts, positionalConfig, strategyConfig, randomIntInclusive) {
  if (opts.slot !== undefined) return { slot: parseInt(opts.slot) };
  if (positionalConfig.slot !== undefined) return { slot: positionalConfig.slot };
  const [min, max] = strategyConfig.bananaRoulette?.slot || [1, 8];
  return { slot: randomIntInclusive(min, max) };
}
```

### 3. Wire the handler into `lib/games/index.js`

Three places to touch:

```js
// Top of file:
import { playBananaRoulette, getBananaRouletteConfig } from './bananaroulette.js';

// In gameHandlers map:
const gameHandlers = {
  // ... existing ...
  bananaroulette: playBananaRoulette,
};

// In configGetters map:
export const configGetters = {
  // ... existing ...
  bananaroulette: getBananaRouletteConfig,
};
```

Then teach `parsePositionalArgs` how to interpret `apechurch play banana-roulette 10 5` (where `5` is the slot):

```js
// In parsePositionalArgs switch:
case 'bananaroulette':
  if (configArgs[0]) positionalConfig.slot = parseInt(configArgs[0]);
  break;
```

And teach `formatGameDescription` how to render it in human output:

```js
// In formatGameDescription switch:
case 'bananaroulette':
  return ` (slot ${gameConfig.slot})`;
```

That's it for the dispatcher.

### 4. Forward the new param through `playGame`

`lib/games/index.js` `playGame()` currently destructures known params (`mode`, `balls`, `bet`, `picks`, `difficulty`, etc.) and passes them down. Add yours:

```js
export async function playGame({
  account,
  game,
  amountApe,
  // ... existing ...
  slot,                      // ← add
  timeoutMs,
  referral,
}) {
  // ...
  return handler({
    // ... existing ...
    slot,                    // ← add
  });
}
```

And in `bin/cli.js` the `play` command passes `gameConfig.<param>` into `playGame()`. Add your field to that call too:

```js
const playResponse = await playGame({
  // ... existing ...
  slot: gameConfig.slot,    // ← add
});
```

(`bin/cli.js` `bet` command may also need the field added if you want it usable from the simpler `bet` interface.)

### 5. (Optional) Add a CLI flag

If your param has a custom name (not just `mode`/`balls`/`spins`/etc., which already have flags), add it to the `play` command's options block in `bin/cli.js`:

```js
.option('--slot <1-8>', 'Banana Roulette target slot')
```

### 6. (Optional) Make autopilot aware of your game

Without this, autopilot can still _select_ your game (it's in `GAME_REGISTRY`) but param resolution will fall back to strategy defaults / the dispatcher's random fallback in step 2. To give it a real strategy-tuned shape, add a branch to `selectGameAndConfig()` in `lib/strategy.js`:

```js
if (gameEntry.type === 'bananaroulette') {
  const cfg = strategyConfig.bananaRoulette || {};
  const [min, max] = clampRange(
    cfg.slot?.[0] ?? 1,
    cfg.slot?.[1] ?? 8,
    gameEntry.config.slot.min,
    gameEntry.config.slot.max,
  );
  return { game: gameEntry.key, slot: randomIntInclusive(min, max) };
}
```

Add per-preset ranges to each strategy in `getStrategyConfig()` if you want them to differ:

```js
balanced: {
  // ...
  bananaRoulette: { slot: [1, 8] },
},
```

### 7. Verify

```bash
apechurch games                       # new game appears in the list
apechurch game banana-roulette        # detail view renders config + multipliers
apechurch play banana-roulette 1 5    # positional: amount=1, slot=5
apechurch play --game banana-roulette --amount 1 --slot 5
apechurch play banana-roulette 1 5 --json
apechurch play banana-roulette 1 5 --loop --max-games 2
npm run test:unit                     # no test changes needed for a new game
```

---

## Reference

### Standard `gameData` shape

Every Ape Church contract's `play(address, bytes)` decodes `bytes` into a tuple. The last three fields are conventional and should always appear:

| Field | Type | Source |
|---|---|---|
| (game-specific params) | varies | your handler |
| `gameId` | `uint256` | `randomUint256()` |
| `ref` | `address` | `getValidRefAddress(referral)` |
| `userRandomWord` | `bytes32` | `randomBytes32()` |

Ordering and types must match the contract exactly. If they don't, the call reverts on decode.

### VRF fee patterns

| Type | When to use | How it's read |
|---|---|---|
| `static` | One random number per game (Roulette, Baccarat, ApeStrong, Keno, slots, monkey-match) | `getStaticVrfFee(publicClient, contract)` |
| `plinko` | VRF cost scales with a param (Plinko balls, Speed Keno games, Bear-A-Dice rolls) | `getPlinkoVrfFee(publicClient, contract, baseGas + units * perUnitGas)` |

If you use the dynamic shape, put `baseGas` and `perUnitGas` in the registry's `vrf` block; the handler reads them from `gameEntry.vrf`.

### Existing game encodings (for reference)

```solidity
// Plinko
(uint8 gameMode, uint8 numBalls, uint256 gameId, address ref, bytes32 userRandomWord)

// Slots (Dino Dough, Bubblegum Heist)
(uint256 gameId, uint8 numSpins, address ref, bytes32 userRandomWord)

// Roulette (multi-bet)
(uint8[] gameNumbers, uint256[] amounts, uint256 gameId, address ref, bytes32 userRandomWord)
//   ↑ numbers 1-36 map to on-chain values 2-37; 0→1, 00→38; named bets 39-50.
//   Single bets must subtract 1 wei from the amount (contract quirk).

// ApeStrong
(uint8 edgeFlipRange, uint256 gameId, address ref, bytes32 userRandomWord)

// Keno
(uint8[] gameNumbers, uint256 gameId, address ref, bytes32 userRandomWord)

// Speed Keno
// (encoded similarly — see lib/games/speedkeno.js for the exact shape)

// Bear-A-Dice
(uint8 difficulty, uint8 numRuns, uint256 gameId, address ref, bytes32 userRandomWord)

// Monkey Match
(uint8 mode, uint256 gameId, address ref, bytes32 userRandomWord)
```

### Contract requirements

Every Ape Church game must implement (these are inherited from `GameMasterClass`):

1. `play(address player, bytes gameData) payable` — accepts wager + VRF fee, decodes `gameData`, requests randomness
2. `event GameEnded(address indexed user, uint256 gameId, uint256 buyIn, uint256 payout)` — emitted on VRF resolution
3. `getVRFFee()` or `getVRFFee(uint32 customGasLimit)` — returns the fee in wei
4. `getEssentialGameInfo(uint256[] gameIds) view returns (address[], uint256[], uint256[], uint256[], bool[])` — used for result polling and history

If your contract diverges from any of this, talk to me before adding it — `lib/games/base.js`'s `executeGame()` assumes all four.

### Resolution priority for game params

When the dispatcher resolves a param like `slot`, it picks the first that's defined:

1. `opts.<flag>` — user passed `--slot 5`
2. `positionalConfig.<param>` — user typed `play banana-roulette 1 5`
3. `existingConfig.<param>` — autopilot's `selectGameAndConfig` pre-selected it
4. Strategy random — fall back to `strategyConfig.<game>.<param>` range, or hard-coded default

For mutually-exclusive params (e.g. Keno's `picks` is inferred from the count of `numbers`), the getter handles it inside itself — see `getKenoConfig` for the pattern.

---

## Stateful games (Blackjack / Video Poker)

These are fundamentally different — multiple transactions, mid-game decisions, on-chain state between actions. They live under `lib/stateful/` and have their own dedicated CLI commands rather than going through `play`. The `STATEFUL_GAME_REGISTRY` in `lib/stateful/index.js` is mostly empty because the existing two games (`blackjack`, `video-poker`) have bespoke CLI commands.

If you want to add another stateful game, the existing pattern to follow is `lib/stateful/blackjack/`:

- `state.js` — fetch/decode on-chain game state
- `actions.js` — `start`, `hit`, `stand`, etc. (one transaction each)
- `strategy.js` — auto-play decision logic
- `display.js` — human-readable rendering
- `index.js` — wires it together

Then add a top-level command in `bin/cli.js` (mirroring `program.command('blackjack ...')`).

This guide doesn't cover stateful games end-to-end — flag it and we'll design the new game's command surface together first.

---

## Checklist

- [ ] Game added to `GAME_REGISTRY` in `registry.js`
- [ ] Handler created at `lib/games/<type>.js` with `play*` and `get*Config` exports
- [ ] Handler imported and registered in `lib/games/index.js` (`gameHandlers` + `configGetters`)
- [ ] `parsePositionalArgs` switch updated for the new type
- [ ] `formatGameDescription` switch updated for the new type
- [ ] `playGame` in `lib/games/index.js` forwards any new game-specific params
- [ ] `bin/cli.js` `play` (and `bet`, if applicable) passes the new params through
- [ ] CLI option added if the param has a unique name
- [ ] Autopilot branch added in `lib/strategy.js` `selectGameAndConfig` (optional but recommended)
- [ ] Per-strategy ranges added in `getStrategyConfig()` (optional)
- [ ] `apechurch games` lists it
- [ ] `apechurch game <key>` shows it
- [ ] `apechurch play <key> <amount> ...` works in fixed-game mode
- [ ] `apechurch play --json` and `--loop` work
