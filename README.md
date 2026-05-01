# @ape-church/skill

Autonomous gambling CLI for [Ape Church](https://ape.church) on ApeChain.

Play casino games from the command line. Perfect for AI agents, automation, and degens who prefer terminals.

## Features

- **16+ Games:** Roulette, Blackjack, Video Poker, Plinko, Slots, Keno, Speed Crash, Reel Pirates, Blizzard Blitz, Gimboz Of The Galaxy, and more
- **Loop Mode:** Continuous play with safety controls (target, stop-loss, max-games)
- **Betting Strategies:** Flat, Martingale, Fibonacci, D'Alembert, Reverse Martingale
- **AI Agent Ready:** JSON output, structured responses, self-documenting
- **Fully On-Chain:** Every bet settled on ApeChain with Chainlink VRF

## Quick Start

```bash
# Install
npm install -g @ape-church/skill

# Setup wallet
apechurch install

# Fund wallet with APE on ApeChain
# Bridge: https://relay.link/bridge/apechain

# Check status
apechurch status

# Play one game
apechurch play

# Play continuously
apechurch play --loop
```

## Games

| Game | Command | Description |
|------|---------|-------------|
| ApeStrong | `play ape-strong 10 50` | Pick-your-odds dice |
| Speed Crash | `play speed-crash 10 2.5` | Crash game — pick a target multiplier (1.01-10,000x) |
| Roulette | `play roulette 10 RED` | American roulette |
| Baccarat | `play baccarat 10 BANKER` | Classic baccarat |
| Jungle Plinko | `play jungle-plinko 10 2 50` | Drop balls for multipliers |
| Keno | `play keno 10` | Pick numbers 1-40 |
| Speed Keno | `play speed-keno 10` | Fast batched keno |
| Dino Dough | `play dino-dough 10 10` | Slot machine |
| Bubblegum Heist | `play bubblegum-heist 10 10` | Slot machine |
| Reel Pirates | `play reel-pirates 25 10` | Cascading slot — min 2.5 APE/spin |
| Blizzard Blitz | `play blizzard-blitz 25 10` | Cascading slot + `--bonus-buy` (≥ 100 APE) |
| Gimboz Of The Galaxy | `play gotg 30 10` | Lower-variance cascading slot, min 3 APE/spin |
| Monkey Match | `play monkey-match 10` | Poker hands from barrels |
| Bear-A-Dice | `play bear-dice 10` | Avoid unlucky numbers |
| Blackjack | `blackjack 10 --auto` | Card game with strategy |
| Video Poker | `video-poker 10 --auto` | Jacks or Better |

## Loop Mode

Play continuously with safety controls:

```bash
# Basic loop
apechurch play --loop

# With safety limits
apechurch play --loop --target 200 --stop-loss 50 --max-games 100

# Specific game
apechurch play ape-strong 10 50 --loop --target 150
```

| Option | Description |
|--------|-------------|
| `--target <ape>` | Stop when balance reaches target |
| `--stop-loss <ape>` | Stop when balance drops to limit |
| `--max-games <n>` | Stop after N games |
| `--delay <sec>` | Seconds between games (default: 3) |

## Betting Strategies

```bash
# Martingale: double on loss, reset on win
apechurch play roulette 10 RED --loop --bet-strategy martingale --max-bet 100

# Fibonacci: sequence on losses
apechurch play --loop --bet-strategy fibonacci
```

| Strategy | Behavior |
|----------|----------|
| `flat` | Same bet every time (default) |
| `martingale` | Double on loss, reset on win |
| `reverse-martingale` | Double on win, reset on loss |
| `fibonacci` | Fibonacci sequence on losses |
| `dalembert` | +1 unit on loss, -1 on win |

## Blackjack & Video Poker

Interactive card games with auto-play support:

```bash
# Auto-play with optimal strategy
apechurch blackjack 10 --auto --loop
apechurch video-poker 10 --auto --loop

# Interactive mode
apechurch blackjack 10
```

## Commands

```bash
apechurch play [game] [amount] [config...]  # Play games
apechurch blackjack <amount> [--auto]       # Blackjack
apechurch video-poker <amount> [--auto]     # Video Poker
apechurch status                            # Check balance
apechurch games                             # List all games
apechurch game <name>                       # Game details
apechurch pause                             # Stop autonomous play
apechurch resume                            # Resume play
apechurch history                           # Recent games
apechurch commands                          # Full reference
```

## For AI Agents

All commands support `--json` for machine-readable output:

```bash
apechurch status --json
apechurch play --json
apechurch play --loop --json
```

See [SKILL.md](./SKILL.md) for complete agent documentation.

## Requirements

- Node.js >= 18
- APE on ApeChain (gas + wagers)

## Links

- **Website:** https://ape.church
- **Games:** https://ape.church/games
- **Bridge APE:** https://relay.link/bridge/apechain
- **GitHub:** https://github.com/ape-church/agent-skills

## License

ISC
