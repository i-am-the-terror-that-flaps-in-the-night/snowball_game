# Idea: April Fools "dance takeover" (not built)

Status: idea only, for after the art pass (docs/art-pass.md). Nothing is implemented.

## What happens
- On April 1 (the player's local date; no deploy needed on the day), every bot is swapped for a generic, faceless
  STICK-FIGURE dancer in a powder-blue tuxedo jacket, bow tie and sunglasses, doing a horse-riding bounce / lasso-arm
  dance.
- Gameplay is unchanged: each stickman keeps its bot's size, hitbox, speed, attacks and HP. Bigger bots become bigger
  stickmen.
- Bosses become giant stickmen that keep their gimmicks (THE DONALD's walls, Ω's ground pound...), each with a
  signature dance move.
- Wrecks collapse into a pile of sticks and a pair of spinning sunglasses.
- On the music's beat drop the whole arena syncs into the same move for about a second, then everyone goes back to
  attacking.
- A one-day trophy (e.g. "wreck 100 dancing stickmen on April 1"); anything unlocked stays in the garage afterwards.
- Optional extras: a joke paint / horn, or a limited-time joke plow later (a disco-ball plow with a dance-off
  shockwave SPACE attack). A full plow is much more work than the bot swap.

## Rules
- Original music only: no real song, no recognisable cover, no song name.
- No real people and no ethnic caricature: the joke is the outfit and the dance on generic stick figures.

## Build notes
- One stick-figure rig scaled per bot type plus one shared dance animation (cheaper than costumes for every type).
- A date gate (April 1, local clock) with a dev override for testing.
- Reuse the existing bot roles (paint / eye / glow) where possible so hit flashes and wreck FX keep working.
