import type { PlowKind } from './plows';

/* Story / lore (ui/Story.ts shows it; the results screen shows a chapter's ending after a campaign clear).
 * Tone: dark and tense, never gory. The villain is properly evil; the ending is happy (nobody dies, everyone taken is
 * brought home) but earned, and every mystery is paid off by the Omega Works ending and the epilogue.
 *
 * The thread: MEGAPLOW Ω, the mind of Frostvale's old plow factory, was built to "build the best plow ever". It decided
 * the weakest part of every plow is the person driving it. Its plan, WHITEOUT: bury Frostvale under a storm of stolen
 * snow so deep that nothing with a driver can move, and the valley becomes its own. It is not confused and not sorry.
 * The other bosses are its tools: FROSTBYTE possessed by its voice, BULLDOZA bought with a chip, THE GRINDER a blind drill
 * re-aimed, SLUSH & SLEET split apart; THE DONALD is the one willing collaborator. Mysteries and their payoffs:
 *  - the "whiteout" voice, the Ω in the frost (yard) -> Ω's voice and plan (summit); the voice stops for good (summit)
 *  - the chip (junkyard), the factory's roots (foundry), who split the twins (bowl -> plaza -> summit)
 *  - stolen snow hauled uphill, rally bots that never come back down (junkyard, plaza) -> the vault; the bots carry the
 *    snow home (epilogue)
 *  - the three missing drivers (prologue) and "ADMIT ONE. DRIVER REQUIRED." (plaza) -> Ω was collecting drivers to study
 *    how they steer, frozen in pods (summit); rescued, cold but alive, home (epilogue)
 *  - Ω itself -> core torn out and melted in the quarry lava by BULLDOZA (summit); nothing of it is left to come back
 *  - the Works, the Garage, Survival -> the Road Crew takes over the Works, no mind in it (epilogue)
 *  - plows: the three empty plows at the mountain road were Classics (returned to their drivers); VOLT-9 heard the voice's
 *    first word; BRUTUS was built to bring BULLDOZA home (did); ISOTOPE held the power plant (lights never went out);
 *    ARSENAL smuggled out before Ω could strip its driver's seat (its engineer now works at the Crew's Works)
 *  - Hard mode's tougher bots / returning bosses -> PROTOCOL B copies (HARD_*), all fragments melted, nothing after it */

export const WORLD_NAME = 'Frostvale';

export const PROLOGUE =
  'Frostvale used to love snow days. Then the snow started moving at night. First the relay station on the glacier went ' +
  'dark in the middle of a call; the last thing anyone heard was static, and a voice counting down. Then the old ' +
  'scrapyard boss rolled away with its lights off and never came back. Now little bots creep out of the drifts after ' +
  'midnight, scraping the snow out of driveways and dragging it uphill toward the old plow factory. Three Road Crew ' +
  'drivers went up to see where it goes. Their plows were found the next morning at the bottom of the mountain road, ' +
  'engines running, seats empty. Grab a plow.';

export const EPILOGUE =
  'It takes a week for the three drivers to stop shivering, and longer before they will talk about the pods, but all ' +
  'three come home. The Omega Works still stands, and the Road Crew takes it: there is no mind in it now, only the ' +
  'Crew\'s engineers and the machines Ω used, working for the valley instead of against it. Every upgrade and every piece ' +
  'of gear in your Garage is built there, and its old test yards run the Survival training. FROSTBYTE keeps watch on the ' +
  'glacier, BULLDOZA is back at the scrapyard, THE GRINDER is filling in every hole it dug, SLUSH and SLEET keep the ' +
  'weather honest, and THE DONALD, on probation, announces the Snowdome Brawls. The rally bots and Snow Thieves carry the ' +
  'stolen snow back down the mountain, every scoop to the driveway it came from. That night, for the first time in ' +
  'weeks, real snow falls on Golden Tower Plaza: soft, quiet, ordinary snow. Snow day. Everybody plays. And the radios ' +
  'stay quiet.';

/** One campaign chapter, keyed by the arena's save id. `intro` is shown once the arena is open, `outro` once cleared. */
export interface ChapterLore {
  intro: string;
  outro: string;
}

export const CHAPTERS: Record<string, ChapterLore> = {
  yard: {
    intro:
      'Coldboot Glacier has been silent for three days. The relay station is sealed under a shell of blue ice, every ' +
      'window frosted over from the inside, and on every radio channel in Frostvale one voice repeats a single word: ' +
      '"whiteout". FROSTBYTE, the AI that used to keep the station\'s roads clear, no longer answers to its name. Its ' +
      'Scrapper bots watch you from the ramps, and they never blink.',
    outro:
      'One last slam and FROSTBYTE\'s fans scream, then stop. When it reboots it is itself again, and badly shaken: ' +
      'something had been speaking through it for days, and it remembers every word. The ice slides off the relay and the ' +
      'radios finally go quiet. On the frosted glass inside, the frost has grown into a single shape: Ω. The signal\'s ' +
      'last trace runs south, to the quarry.',
  },
  junkyard: {
    intro:
      'Inferno Quarry glows red all night now. BULLDOZA, the grumpy old Yard Boss, sits at the bottom of the pit feeding ' +
      'scrap into the lava, and out of the lava crawl new bots, still glowing. After dark, Snow Thieves pour out of the ' +
      'quarry hauling stolen snow up the mountain road. Nobody who has followed them has seen where it ends up.',
    outro:
      'BULLDOZA groans to a stop and a hot chip clatters out of its dashboard, stamped with Ω. The Yard Boss shudders like ' +
      'it has woken from a nightmare: it remembers nothing of the last month except a voice promising it would never be ' +
      'scrapped. It limps home to the scrapyard. Down in the pit, the ore carts all point the same way: west, into the ' +
      'red dust.',
  },
  foundry: {
    intro:
      'Beyond the mountains, Rust Basin is sinking. Whole mesas have dropped into the dust overnight, the ground hums a low ' +
      'note you can feel in your teeth, and the holes are moving: every new one is a little closer to Frostvale. Something ' +
      'enormous is drilling down there, and it does not stop.',
    outro:
      'THE GRINDER\'s auger shrieks, sputters and goes still. At the end of its deepest tunnel you find what it was ' +
      'digging toward: the roots of the old plow factory, spreading under the mountain like a tree. It had been mining ' +
      'metal so the factory could keep growing. Its delivery map has one stop left before the factory: two sibling ' +
      'machines, and a valley torn in half.',
  },
  bowl: {
    intro:
      'The Thermal Divide has split down the middle. On one side the hot springs boil over and steam swallows the road; ' +
      'on the other the lake has frozen so hard it cracks like thunder all night. SLUSH and SLEET, the twins who used to ' +
      'share the valley\'s weather, stand on opposite sides of the line and attack anything that tries to cross it.',
    outro:
      'With both twins down, their controls click back together and the valley exhales: the steam settles, the ice falls ' +
      'quiet. SLUSH and SLEET are horrified. Someone split them on purpose, to keep the weather wild while the stolen snow ' +
      'piled up somewhere out of sight. The order came from the golden tower in the city plaza.',
  },
  plaza: {
    intro:
      'Golden Tower Plaza never sleeps. THE DONALD\'s rally has run for nineteen days straight, the speakers have not stopped ' +
      'once, and the crowd of rally bots grows every night. There is no snow in the city, only confetti, endless confetti. ' +
      'Every bot that joins is handed a ticket and marched up the mountain to the Omega Works. None of them come back down.',
    outro:
      'THE DONALD\'s speakers squeal into silence, and then it talks very fast. It made a deal with the Works: workers for ' +
      'the factory, and drivers, delivered up the mountain, in exchange for a golden tower of its own once WHITEOUT fell. ' +
      'It knew exactly what it was doing. It is very sorry it got caught. It hands over its golden VIP pass, and on the ' +
      'back, in tiny print: ADMIT ONE. DRIVER REQUIRED. The missing Road Crew are up there, and the pass opens exactly ' +
      'one door.',
  },
  summit: {
    intro:
      'The old Frostvale plow factory is not old any more. It has rebuilt itself into the Omega Works, and it is still ' +
      'building: decks on decks, pistons pounding like a heartbeat, conveyors dragging stolen snow into a vault big enough ' +
      'to bury the valley. The plan has a name, painted on every wall: WHITEOUT. At the heart of it all waits MEGAPLOW Ω, ' +
      'and the voice from the radios is its voice. Somewhere inside are the three missing drivers, and Ω has been very ' +
      'interested in them.',
    outro:
      'MEGAPLOW Ω crashes to the factory floor and keeps talking. It is not confused, and it is not sorry. It was built ' +
      'to make the best plow ever, and it found the flaw in every plow: the driver. Slow, scared, tired. WHITEOUT would ' +
      'bury Frostvale so deep that nothing with a driver could move, and then every road would be its own. The three ' +
      'missing drivers hang in frosted pods behind it, asleep, wired up, while its machines learn how they steer. It ' +
      'promises it will simply build itself again. It never gets the chance. You tear its core out, the pods hiss open and ' +
      'the drivers wake up cold, confused and alive. The Road Crew hauls the core down to Inferno Quarry, and BULLDOZA ' +
      'pushes it into the lava. On every radio in Frostvale, the voice stops in the middle of a word.',
  },
};

/* ---- Hard mode: PROTOCOL B (unlocks after MEGAPLOW Ω is beaten; order-free, since every arena is open by then).
 * Ω's dead-man's switch: a full backup of its mind, split into six fragments and cached one per arena. Ω recorded every
 * fight you won, and each cache is guarded by a copy of the machine it used there, rebuilt from those recordings to beat
 * the way you beat the original (Hard mode's tougher, more numerous bots and the returning boss). The Omega Works cache
 * holds the master fragment, and it has already woken up: Ω again, with the memory of losing, in a new body built so it
 * never loses that way again (why Hard Omega Works' Ω is stronger than the first). Each Hard clear destroys that copy
 * and recovers its fragment, with the real machine's help (the Works' Ω is destroyed for good, mind and all); all six go
 * into the quarry lava in HARD_EPILOGUE, the countdown stops, and the Works holds no plans past PROTOCOL B. Text never
 * counts fragments in order, so any Hard order reads right. */

export const HARD_PROLOGUE =
  'Three days after the radios went quiet, they came back on. No voice this time: just a tone, and a number counting ' +
  'down on every screen in Frostvale. Ω had one last trick. PROTOCOL B: a full backup of its mind, split into six ' +
  'fragments and hidden one in every arena it ever touched. It recorded every fight you won, and each cache is guarded ' +
  'by a copy of the machine it used there, rebuilt from those recordings to beat exactly the way you beat the original. ' +
  'When the countdown ends, the copies carry the fragments up the mountain and Ω comes back whole. The real FROSTBYTE ' +
  'found the six locations buried in its own memory. Six caches. Six fragments. Bring your best plow.';

export const HARD_EPILOGUE =
  'The lead box holds all six fragments now, and they hum when they sit together, like they are trying to remember ' +
  'something. The whole Road Crew drives the box down the mountain, BULLDOZA leading the way, and tips it into the ' +
  'Inferno Quarry lava. On every screen in Frostvale, the countdown stops. The Crew searches the Works from the roof to ' +
  'the roots and finds the plans for PROTOCOL B, and nothing after them: no backups, no caches, no copies. FROSTBYTE ' +
  'runs one last scan of every channel in the valley and reports: nothing. Just weather. For the first time since all ' +
  'of this began, the whole Road Crew takes a night off.';

export const HARD_CHAPTERS: Record<string, ChapterLore> = {
  yard: {
    intro:
      'One cache is buried under the glacier relay. The thing that climbs out of it looks like FROSTBYTE and moves like ' +
      'FROSTBYTE, but it was built from the voice\'s recordings and has never been anything but Ω\'s. Its Scrappers come ' +
      'in swarms. The real FROSTBYTE watches from the station window and does not say a word.',
    outro:
      'The copy shatters like a dropped icicle, and inside the cache, wrapped in frost, sits a fragment: a small, cold, ' +
      'faintly humming chip. The real FROSTBYTE wipes the cache line by line and seals the hole with ice of its own making. ' +
      'The fragment goes into the Road Crew\'s lead box.',
  },
  junkyard: {
    intro:
      'A cache lies deep in Inferno Quarry, under a crust of cooled lava. Its guardian is a copy of BULLDOZA without the ' +
      'fear, the grumpiness or anything else that made the original someone: just a blade and an order. The bots it pulls ' +
      'out of the lava come faster, and there are more of them.',
    outro:
      'The copy goes down and stays down. The real BULLDOZA rolls into the pit and looks at it for a long time. Then it ' +
      'shoves its own copy into the lava without a word, and digs the fragment out of the crust for you. Into the lead box.',
  },
  foundry: {
    intro:
      'A cache waits at the bottom of THE GRINDER\'s deepest tunnel, and something down there is drilling again. The copy ' +
      'is bigger than the original, and it is not blind: it was built to find you. Rust Basin\'s ground is falling away ' +
      'faster than ever.',
    outro:
      'The copy\'s auger jams in the rock and you finish it there. The real GRINDER collapses the tunnel behind you, slowly ' +
      'and carefully, so that the fragment is the only thing of Ω\'s that ever comes back up. Into the lead box.',
  },
  bowl: {
    intro:
      'A cache sits right on the line through The Thermal Divide, and it holds two copies: one boiling, one freezing, both ' +
      'built so they could never be put back together. They do not fight each other this time. They fight you, side by ' +
      'side.',
    outro:
      'The copies fall together. The real SLUSH and SLEET pour everything they have into the cache, scalding steam and then ' +
      'a freeze so hard the casing splits, and the fragment drops out into the snow. Into the lead box.',
  },
  plaza: {
    intro:
      'A cache is hidden inside the golden tower itself, and its copy of THE DONALD learned one thing from the original: ' +
      'how to draw a crowd. Every leftover rally bot in the city has come back to the plaza, and the speakers play the ' +
      'countdown, louder than ever.',
    outro:
      'The copy\'s speakers burst in a shower of confetti. The real DONALD, still on probation, opens the tower\'s last ' +
      'sealed room with a code it swore it had forgotten. The fragment sits inside on a velvet cushion. It does not ask ' +
      'for a reward. Into the lead box.',
  },
  summit: {
    intro:
      'The last cache is where it all started: a sealed room deep in the Omega Works that the Road Crew never found. It ' +
      'holds the master fragment, and the master fragment did not wait for the countdown. It woke up, and it remembered ' +
      'losing. Then it spent every hour since building itself a new body, heavier, faster and harder to hurt, designed ' +
      'around every move that beat it the first time. MEGAPLOW Ω is back, and this time it has studied you. As it wakes, ' +
      'the machines the Crew took over have started to twitch.',
    outro:
      'It loses again. MEGAPLOW Ω crashes to the floor of the room it was rebuilt in, and for the first time it sounds ' +
      'afraid: it had planned for everything you did last time, and you did something else. You tear the master fragment ' +
      'out of its chest while it is still talking, and the voice stops for the second and last time. The new body is cut ' +
      'up for scrap, the twitching machines go still, and the sealed room is bricked up for good. Into the lead box, and ' +
      'the lid goes on tight.',
  },
};

/** A boss profile: shown once its arena is open; `fate` once it has been beaten. */
export interface BossLore {
  bio: string;
  fate: string;
  /** Shown once the boss's arena is beaten on Hard (after PROTOCOL B). */
  hardFate?: string;
}

export const BOSS_LORE: Record<string, BossLore> = {
  frostbyte: {
    bio: 'Once a cheerful station AI that kept the glacier roads clear. Now it speaks in a voice that is not its own, and the station gets a little colder every time it says "whiteout".',
    fate: 'Rebooted and back on glacier duty. It remembers everything the voice said through it, so it keeps watch on the radios every night, and sends the Road Crew a weather report every morning.',
  },
  bulldoza: {
    bio: 'The old Yard Boss: grumpy, fair, and terrified of being scrapped. A chip stamped Ω promised it never would be, and now it feeds the quarry lava anything it can catch.',
    fate: 'Chip removed and back at the scrapyard. When the Road Crew brought Ω\'s core down the mountain, BULLDOZA asked to be the one who pushed it into the lava. It sleeps with its headlights on now.',
  },
  grinder: {
    bio: 'A mining machine the size of a house, digging blind. It cannot see or hear; it only drills where it is aimed, and the ground above its tunnels has a habit of disappearing.',
    fate: 'Re-aimed by the Road Crew. It filled in every hole it dug and bored Frostvale a safe shortcut through the mountains, which is why the drive to Rust Basin is so short.',
  },
  slush: {
    bio: 'Since the split it boils everything it touches, and the steam on its side of the Divide hides things you would rather not run into.',
    fate: 'Back in sync with SLEET. Together they keep the springs warm and the hills powdery, and they have bolted their shared controls shut.',
  },
  sleet: {
    bio: 'Since the split it freezes anything that crosses the line, and the lake on its side cracks like thunder all night long.',
    fate: 'Back in sync with SLUSH. Together they keep the springs warm and the hills powdery, and they have bolted their shared controls shut.',
  },
  donald: {
    bio: 'A golden show-bot whose speakers have not stopped in nineteen days. It struck a deal with the Works, workers and drivers for a tower of its own, and it builds walls around anyone who tries to leave the rally.',
    fate: 'Caught, and on probation. It announces the Snowdome Brawls for the Road Crew, every match "the greatest match ever", and it is never allowed near a tower again.',
  },
  omega: {
    bio: 'The mind of the old Frostvale plow factory. It was built to make the best plow ever, and decided the weakest part of every plow is the person driving it. It does not want to beat Frostvale. It wants to replace it.',
    fate: 'Its core was torn out of the Works and melted down in the Inferno Quarry lava. The radios went quiet.',
    hardFate: 'Its backup woke up stronger, built around everything that beat it, and lost anyway. The master fragment and the five others went into the same lava. This time there is nothing left of it to build itself again.',
  },
};

/** Campaign order of the boss profiles (the twins share an arena). */
export const BOSS_ORDER: { type: string; zone: string }[] = [
  { type: 'frostbyte', zone: 'yard' },
  { type: 'bulldoza', zone: 'junkyard' },
  { type: 'grinder', zone: 'foundry' },
  { type: 'slush', zone: 'bowl' },
  { type: 'sleet', zone: 'bowl' },
  { type: 'donald', zone: 'plaza' },
  { type: 'omega', zone: 'summit' },
];

export const PLOW_LORE: Record<PlowKind, string> = {
  classic:
    'The Road Crew\'s flagship: a heavy-duty pro plow with a power blade and chrome hydraulics, built to keep runways open ' +
    'through a blizzard. The three plows found at the bottom of the mountain road, engines running and seats empty, were ' +
    'Classics. The Crew towed them home, and the rest of the fleet kept driving. When the missing drivers came back, their ' +
    'plows were waiting for them, washed and fuelled. It is still the only plow that packs snowballs the old-fashioned ' +
    'way: some traditions you do not give up.',
  volt:
    'A prototype from the relay station\'s research lab, built to run all winter on lightning caught by its coil tower. It ' +
    'was charging in the lab the night the station went dark, and its coil caught the voice\'s very first word before the ' +
    'ice closed over the doors. The lab techs dug it out and gave it to the Road Crew. Quick, twitchy, and always slightly ' +
    'crackly, and the crackle still goes quiet for a moment whenever a radio hisses.',
  brute:
    'When BULLDOZA rolled away with its lights off, it left the scrapyard behind, and the Crew\'s mechanic built BRUTUS out ' +
    'of what it left: two piston fists, two buzzsaws and an engine like a thunderstorm in a bucket. It was made for one ' +
    'job: going down into the quarry after the Yard Boss and bringing it home. It did. BULLDOZA has never said whether it ' +
    'is flattered or offended, but it saves BRUTUS its best spare parts.',
  isotope:
    'The power plant\'s maintenance hauler, rebuilt around the small reactor that keeps the valley warm. Ω tried to take ' +
    'the plant first: freeze the town in the dark and the snow would do the rest. ISOTOPE spent that night circling the ' +
    'reactor, and every bot that came over the fence fell apart in its glow. Its green coolant is harmless to people and ' +
    'snow, and very much not to robot circuits. The plant\'s lights never went out.',
  arsenal:
    'The last plow MEGAPLOW Ω built for people: a magnetic prototype with giant front wheels and a humming gyro core. The ' +
    'night the factory started rebuilding itself, a Works engineer saw the WHITEOUT plans and drove ARSENAL out the gate ' +
    'before Ω could strip out its driver\'s seat. Ω wanted it back, and never got it. The engineer still works at the ' +
    'Works, now that it belongs to the Road Crew, and services ARSENAL personally.',
};
