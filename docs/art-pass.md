# Art pass plan: "polished realistic-lite"

Status: stage 0 (sample + tools) built, awaiting the gate (see "Stage 0 lighting sample" below). Stage 0 is an approval gate: nothing rolls out
to the whole game until the sample is approved.

Goal: the game keeps today's lighting model (PBR, no outlines) but everything looks finished: beveled shapes instead
of raw boxes, panel detail, soft shadow in corners, reflections that match the arena, tuned lighting per arena. No
gameplay change: hitboxes, sizes, speeds, silhouettes and effects stay as they are.

## What the first draft got wrong (and what changed)

1. **It ignored the draw-call machinery the game already depends on.** Static, untextured, opaque parts are collapsed
   into ONE shared material (`src/render/palette.ts`), merged into a few draws (`src/render/mergeStatic.ts`), with one
   shadow proxy per model (`src/render/shadowProxy.ts`) and a shader warm-up (`src/render/warmup.ts`). A part is only
   eligible while its material has no texture, no env map and no vertex colours. The draft's "shared textured
   materials", "per-material arena reflections" and "vertex-colour AO" would each have made most parts ineligible and
   multiplied the draw calls. Every technique below is chosen to keep parts eligible.
2. **"Remodel" was the wrong word and the riskiest part.** Models carry rigs, animated groups, paint / eye / glow
   roles, wreck debris, hologram (echo) variants and 20+ paints. They are upgraded in place (same skeleton, same
   roles, better shapes and added parts), never rebuilt from scratch.
3. **The priorities were backwards.** The vehicles are ~4,400 lines of model code (`src/entities/vehicles/*`,
   `plowModels.ts`); all ~23 bot and boss types together are ~1,700 (`src/entities/enemies/models.ts`). Plows are already the most detailed thing in the game, bots the least, and bots are what the
   player looks at most. Bots and bosses go first; plows get a consistency pass, not a rebuild.
4. **It spent detail where the camera cannot see it.** From the chase camera a bolt on a bot 20 m away is smaller than
   a pixel and only shimmers. Detail follows a hierarchy (below), and fine detail goes only where close-ups happen.
5. **The speed budget could not be checked.** "2 ms a frame" cannot be measured in the build container (software
   renderer, no GPU). Budgets are now in things that can be counted, and the existing `scripts/render-probe.mjs`
   (baseline / compare, pixel diff, per-scene metrics) is the gate for every stage.
6. **Lighting was treated as a side effect.** A global lighting change moves the colours of every arena, day and
   night, plus PROTOCOL C: about 15 looks to re-tune. It is its own stage with before / after shots of every one.
7. **Things it forgot:** Brawl rival models (`src/brawl/models.ts`), the Duel opponent, the garage preview, bot wrecks
   and debris, echo holograms, PHANTOM's ghost shell, MEDIUM quality (it only said HIGH and LOW), and AUTO quality
   (a slower frame silently drops players a tier, so the budget protects more than frame rate).

## Rules

- **Detail hierarchy.** Big forms (silhouette, proportions) are untouched. Medium detail (bevels, panel breaks, light
  housings, vents, contact shadow) goes on everything. Fine detail (bolts, small decals, seams) goes only where the
  camera gets close: the player's plow, bosses, the garage, boss intros, kill-cam and ult-cam.
- **One shading decision for everything:** chamfered edges with smooth normals across the bevel and flat faces
  (today plows are mostly smooth and bots are fully flat-shaded "toy robot" facets). Confirmed or changed at the
  stage 0 gate.
- **Budgets (per scene, measured by the render probe against a baseline taken before stage 0):** draw calls +10% at
  most on HIGH, 0% on LOW (main and shadow pass); triangles +60% on HIGH, +15% on LOW; shader programs +3 at most
  (the probe's `programs` count); no program compiled after the loading screen (warm-up covers every new material);
  zero per-frame allocation added. A chamfered box is ~44 triangles against a plain box's 12, so bevels go on the
  edges the camera sees on big parts, not on every box; the crowd never gets bevels.
- **Quality tiers:** one new lever, `detail` (`src/core/settings.ts` QualityPreset): HIGH = everything, MEDIUM = no
  fine detail on bots, LOW = medium detail only and no screen-space pass.
- **Real-device check:** a small FPS / draw-call readout (debug option, built on the frame-time sampler AUTO quality
  already has in `src/core/settings.ts`) so frame rate can be read on a real machine before each stage is accepted.
  The container can count draws, not time them.
- **How the probe runs here:** `PW_EXE=/opt/pw-browsers/chromium PROBE_GPU=0 PROBE_DPR=1 PROBE_LOOPS=3` (software
  renderer; its timings mean nothing, its counts are exact). Its pixel diff fails on purpose for every scene a stage
  restyles, so counts are the gate there; the pixel diff is used the other way round, to prove a stage did NOT change
  what it should not have (e.g. stage 2 leaves an empty arena pixel-identical).
- **Names stay put:** part names and roles that code and tests look up (`CHAIRMAN_PART`, `userData.role`, paint /
  eye / glow / ball roles, wreck pieces) keep their names and meaning.
- **A category lands whole.** All bots change in one merge, all arenas in one, so the live game never shows half a
  category in the old look. Each stage is one merge and can be reverted on its own.
- **Every stage's checklist:** day and night, HIGH and LOW, every paint on every plow (stage 4), wrecks and debris,
  echo holograms, Brawl and Duel, the garage preview, render-probe report, tsc / tests / build.

## Techniques (all palette- and merge-friendly)

- **Arena reflections and softer ambient light:** one small environment map per arena (day / night), set on the
  scene (`scene.environment`), not per material, so palette parts stay eligible and paints / chrome reflect the real
  arena. Direct lights are re-balanced so overall brightness does not jump. Side effects to handle: it changes the
  shader program of every standard material (warm-up must run after it is set, on every arena build); it is built
  once per arena load (a small PMREM from a cheap procedural sky + arena colours, not a scene capture, so the loading
  time barely moves); the paints' own reflection map (`src/render/reflections.ts`) is replaced by the arena one so
  plows match their arena; and brighter highlights on chrome and snow must stay under the bloom threshold
  (`BLOOM.threshold` in `src/render/post.ts`), checked at night first.
- **Corner shadow (AO), two candidates measured in stage 0:**
  - *Baked:* an occlusion value per vertex computed once inside the existing merge step and multiplied in by the
    palette material itself (one change in `palette.ts` / `mergeStatic.ts`). Free at run time, static geometry only,
    coarse on big flat boxes.
  - *Screen-space, HIGH only:* one half-resolution pass in the existing post pipeline (`src/render/post.ts`). Covers
    moving things (plows on the ground, bots against walls) and needs no model work, but costs GPU time. Constraints:
    that pipeline only exists while Bloom is on (otherwise the frame is a plain render to the canvas); its target
    has no depth texture today, so one is attached; and normals are rebuilt from depth, because a separate normal
    pass would re-draw the whole scene and double the draw calls.
  - Dynamic models also get a soft contact-shadow patch underneath (cheap, all tiers).
- **Detail kit** (`src/render/kit/`): chamfered box / panel / plate builders, inset seam strips, vents and grilles,
  light housings with lenses, hinges, bolts and rivets. On models every kit part is merged into the model's existing
  draws (same shared materials, paint parts into the paint mesh), never an InstancedMesh per bot: that would add a
  draw per bot per part type. Instancing is only for repeats in the static arena dressing.
- **Shared material library:** painted metal, bare steel, rubber, plastic, glass, chrome, concrete as named presets
  (plain colour / roughness / metalness, so they stay palette-eligible), replacing per-file hand-picked values.

## Stage 0 lighting sample: what is built (all OFF by default until the gate)

- `src/render/look.ts`: the switches. URL `?look=off|env|baked|ssao|all&strength=subtle|strong`, or live from the
  console (`setLook`). `LOOK_STRENGTHS` holds every number of "subtle" and "strong"; `LOOK_STRENGTH` is the one a chosen
  look ships with.
- Arena reflections (`src/render/arenaEnv.ts`, built in `Environment.setZone` → `buildEnvMap`): a procedural sky from
  the arena's own light / sky / palette numbers, PMREM'd into one persistent 128 px cube-UV target, set as
  `scene.environment`; the hemisphere light hands its `envShare` of the ambient to it (irradiance-matched, see
  `hemiRadiance`); a specular-only gain lifts reflections without lifting diffuse; lamps capped at `LUM_CAP` (under
  the bloom threshold). Plow paints take it through `getPaintEnvMap` (returns null → `scene.environment`).
- Baked corner occlusion (`src/render/bakedAO.ts`, `palette.ts applyBakedAO`, `StaticBatch.flush(parent, ao)`): an
  occupancy grid + short hemisphere rays per vertex (merged static parts) and per instance vertex (static instanced
  dressing, via one small texture), multiplied in by the destination materials. The snow floor gets none (it is not
  static geometry).
- Screen-space AO (`src/render/post.ts` `AOPass`, `SSAO`): HIGH (`QualityPreset.ssao`) + Bloom path only; depth texture
  on the scene target, half-res AO + 2 blur passes, applied in the bright and output passes (before the glow).
- Contact patches (`src/render/contactShadows.ts`): one instanced draw under the plow, bots and Brawl rivals.
- `QualityPreset.detail` (`'high' | 'medium' | 'low'`) for the model work; `QualityPreset.ssao` (HIGH only).
- Performance readout (`src/ui/perfHud.ts`): Settings › Performance readout, or `?debug`.
- Probe: `PROBE_QUERY=look=baked` appends URL flags; a scene named `<scene>@night` runs it at night.

## Stages

| Stage | What | Gate |
|---|---|---|
| **0. Sample + tools** | Render-probe baseline of every scene. FPS / draw-call readout. First cut of the kit and material library. Sample: the Plaza (one whole arena, day and night), two bots (grunt-class and a big one), one boss, the Classic. Both AO candidates measured. Two strengths ("subtle" and "strong") side by side. | **You approve the look, the strength and the shading decision.** I report counts for each AO option. |
| **1. Lighting** | Arena reflections + re-balanced lights + the chosen AO for all 7 arenas, day and night, and every PROTOCOL C stage. | Before / after gallery of every arena. |
| **2. Bots** | All regular bot types upgraded in place with the kit; wrecks and debris; echo holograms; Brawl rivals. | Line-up shots + a busy Survival wave within budget. |
| **3. Bosses** | The six bosses, THE CHAIRMAN, THE WHITEOUT's props; fine detail allowed (intro and kill-cam close-ups). | Boss intro shots, PROTOCOL wave 7 within budget. |
| **4. Plows** | Consistency pass on all 7 (kit bevels, material presets, light housings); paint matrix (every paint on every plow); garage preview. | Paint matrix gallery. |
| **5. Arenas** | Props, ramps, walls, stands, floor trim for all 7 arenas. | Before / after gallery, Omega Works within budget. |
| **6. Crowd** | More varied spectator shapes and colours, less visible repetition (still instanced). | Stand close-ups, day and night. |
| **7. Final pass** | LOW / MEDIUM sweep, warm-up probe (no stutter), render-probe report for every scene, docs. | Counts table; your FPS check. |

Stages 2 and 5 touch different files and can run in parallel once stage 1 is in. Stage 0 is a few hours; the whole
pass is several sessions.
