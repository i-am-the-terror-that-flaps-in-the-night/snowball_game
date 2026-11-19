# Motion & weight pass (plan)

Status: planned, not started. Visual only: no gameplay, hitbox, balance or netcode change.

Goal: vehicles and bots stop moving like rigid toys. Weight comes from three things: a body that reacts to forces
(suspension), targets that react to being hit, and wrecks that tumble instead of popping. Impact frames sell the big
hits on top.

## What already exists (and why it still reads as "toy")

- Plow body (src/entities/plow/PlowVisuals.ts ~600-640): lean into turns (max 0.07-0.12 rad), pitch with acceleration
  (max 0.06 rad), a landing squash, slam rear-back / lunge pose, recoil kick, jitter. All FIRST-ORDER smoothing
  (`x += (target - x) * k`): the body eases to the target and stops, it never overshoots or rebounds, and the
  amounts are small. That is the "toy" read: real suspension springs past and settles.
- Wheels are an instanced set (PlowBase wheels): they roll, they never compress.
- Bots (src/entities/Enemies.ts): a hit flashes the paint (FLASH_T 0.12 s) and adds knockback velocity; the body
  itself never tilts, staggers or shakes.
- Wrecks (Enemies.kill ~1537 -> disposeRig ~1767): the bot vanishes at once and generic debris chunks fly
  (MAX_DEBRIS 180, pooled InstancedMeshes, smoke on half of them).
- Impact feel (src/fx/impact.ts): hit-stop (sim x0.04 for 35-160 ms per kind), slow-mo on final / boss kills,
  camera kicks, FOV punches, impact lights, a DOM flash on the nuke. Good foundation; missing is a per-target
  "impact frame" (the victim flashes white / frozen sparks) and stronger tiers.

## Physics engine: Rapier? No (for now)

Rapier (WASM) would add ~1.5-2 MB of download plus an async start before the menu, against the fast-load goal for
portals, and it would be a second physics world next to the game's own arcade physics (the plow, bots, terrain,
decks and the Duel all run on custom code that must stay authoritative). Everything this pass needs is cosmetic:
spring-dampers for bodies, and short-lived tumbling wrecks that only have to bounce on the terrain height field and
the arena walls. A small custom "cosmetic rigid body" (position, velocity, orientation quaternion, angular velocity,
gravity, 6-8 hull points sampled against ctx.terrain ground / snow top, restitution + friction, wall planes) covers
that in a few hundred lines with no download. Revisit Rapier only if wrecks must collide with each other and with
props (lazy-loaded, for that feature alone).

## The work

### 1. Plow suspension (all 6 plows, the Duel opponent, Brawl rivals)
- Replace the first-order lean / pitch / squash with a SECOND-ORDER spring-damper per axis on the visual body:
  heave (y), pitch, roll. Inputs: longitudinal acceleration (squat / dive), lateral acceleration
  (speed x yaw rate -> roll), landing vertical speed (compression), terrain bumps (snow depth / slope change), hits
  taken (a shove), slam / dash / ult kicks. Slightly under-damped so it overshoots once and settles.
- Per-plow tuning (a SUSPENSION table): BRUTUS heavy and slow (low frequency, big compression), VOLT-9 light and
  twitchy, ARSENAL stiff (gyro), ISOTOPE soft (heavy load on the back), PHANTOM floaty (it hovers a little),
  Classic in between.
- Wheels: per-wheel visual compression (each wheel instance offset up by its share of heave + pitch + roll), so
  wheels tuck into the arches on landings and hard turns. Tracks (BRUTUS) flex at the road wheels.
- Caps so it never clips through the ground or reads as seasickness; the camera does NOT follow the body roll.

### 2. Bot hit reactions
- Per-bot visual spring state (a few floats, no allocation): on damage, an impulse in the hit direction scaled by
  damage / mass -> the body tilts away and springs back, a short positional recoil, a squash on heavy hits, a brief
  stagger shake on big hits; bosses react less (mass) but still visibly.
- Metal sparks at the hit point (existing Fx bursts, a hot-white -> orange spark preset), plus a small dent pop:
  a loose panel / antenna wobble on the light bots where a part already exists.
- Applied to rig.body (the group that already carries the body); animated parts (spinY, lift, ball) unaffected.

### 3. Tumbling wrecks
- On a kill the bot's own body is handed to a pool of cosmetic rigid bodies (about 12 live; the oldest finishes
  early): launched by the killing hit (direction + strength), spins, bounces off the terrain and walls, skids,
  then bursts into the existing debris chunks + smoke after 0.8-1.6 s (or sinks into lava).
- Big hits (slams, ultimates, Dash Strikes) launch further; bosses keep their scripted defeats (THE CHAIRMAN /
  THE WHITEOUT sequences, Omega's collapse) untouched.
- The rig is disposed when the wreck bursts instead of at the kill (kill events, coins, AI and HP bars are
  unchanged: only the visual outlives the bot).

### 4. Impact frames
- On the strongest hits (boss hits, slams on big targets, kill shots, ult finishers): 1-2 frames where the victim
  flashes pure white (its paint / eye materials), sparks and debris freeze for the hit-stop, and a short
  directional streak; strength tiers mapped from damage. Existing hit-stop / slow-mo kept, tuned per tier.
- Respect Settings: Reduce camera shake scales the body kicks; Reduce flashing removes the white frames.

## Rules
- Visual only: no change to positions used by gameplay, hitboxes, AI, knockback physics or the Duel's network state
  (both sides animate locally from the same events).
- No per-frame allocation; pools sized up front; LOW quality: fewer live wrecks (6) and sparks (fxScale).
- Warm-up: the spark preset and the wreck pool are built at load.

## Stages
1. Sample (Classic + Scrapper + Brute on Coldboot Glacier): plow suspension, bot hit reactions, tumbling wrecks,
   impact frames. Deliverable: a frame-sequence sheet / short animated capture of driving, cornering, a landing,
   a slam and a kill, before vs after.
2. Rollout: every plow (tuning table), every bot / boss (mass-scaled reactions), Brawl rivals, the Duel opponent.
3. Polish: tuning by feel, LOW-quality check, tests (spring stability, no ground clipping, pool limits, settings).
