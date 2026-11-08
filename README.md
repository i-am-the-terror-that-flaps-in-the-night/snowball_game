# Snowplow Showdown

A Three.js + TypeScript browser brawler. Plow snow into a snowball on your blade (it's your weapon and your shield),
then fight bots up close: slam the ball into them, ram them, dash-strike through them and spin a whirlwind. Every
model, texture, sound effect and music track is generated in code; there are no asset files.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (add ?debug for 100k coins + every arena unlocked)
npm run build      # typecheck + production build into dist/
npm test           # vitest unit tests (tests/*.test.ts)
```

## Controls

| Key | Gamepad | Action |
|---|---|---|
| W / S (↑ / ↓) | Left stick / d-pad, RT / LT | Drive / reverse |
| A / D (← / →) | Left stick / d-pad | Steer |
| Space | A | **Slam** your snowball into whatever is in front (ARSENAL: hold to fire the pulse laser) |
| Shift | B / RB | **Dash**: a long burst; hitting a bot mid-dash is a Dash Strike |
| E | X | **Whirlwind**: spin, pull bots in, blast them out, suck up snow (ARSENAL: Grav Lance) |
| F | Y | Your plow's **F ability**; when its meter is full, its **ultimate** |
| Esc / P | Start | Pause |
| M | | Mute |

Keys can be rebound in **⚙ Settings** (arrows, right Shift and Esc stay as fixed alternates; Esc and M can't be
bound). In menus the gamepad d-pad / stick moves, A selects and B goes back.

## What's in it

- **Modes:** a six-arena Campaign with bosses and Hard mode, the 180 m **Snowdome Brawl** free-for-all against 8
  rival plows, endless **Survival** with a seeded **Daily** run, an online 1v1 **Duel**, and a short Tutorial.
- **Five plows**, each with its own F ability, upgrade line and ultimate: Classic (Inferno / FIRESTORM), VOLT-9
  (Thunderclap / SUPERCELL), BRUTUS (Ground Pound / EARTHQUAKE), ISOTOPE (Meltdown / NUKE) and ARSENAL, a bladeless
  magnetic / laser vehicle (pulse laser, Grav Lance, Polarity Burst / SINGULARITY). An ultimate that wipes 3+ bots plays a
  slow-motion kill-cam.
- **Garage and gear:** endless core upgrades, a per-plow line, and 16 Prodigy-style gear items in 5 slots that you
  buy, level to ★10, equip and see on your plow. Bosses, Hard clears, Survival boss waves and Brawl podiums drop gear.
- **Destructible props:** crates and ice blocks that you, a charging boss or a bot you knock flying can smash.
- **Meta:** challenge stars, 50 trophies, a Paint Shop, lifetime stats, save export / import.

## Docs

- [docs/modes.md](docs/modes.md): Campaign, Brawl, Survival + Daily, Tutorial, props, stars and Hard mode, settings
- [docs/plows.md](docs/plows.md): every plow's abilities, upgrade line and ultimate, and the kill-cam
- [docs/progression.md](docs/progression.md): the Garage, the full gear list, loot odds, trophies, Paint Shop, saves
- [docs/duel.md](docs/duel.md): hosting / joining, the duel garage and catch-up, netcode
- [docs/development.md](docs/development.md): project layout, tests, headless probes, the balance harness
- [docs/balance.md](docs/balance.md): balance numbers and the reasoning behind them
- [docs/history.md](docs/history.md): how the game got here, from the snowball-cannon base defense to today
