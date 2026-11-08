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
 *  - ARSENAL (plows) -> smuggled out before Ω could strip its driver's seat; Ω never got it back */

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

/** A boss profile: shown once its arena is open; `fate` once it has been beaten. */
export interface BossLore {
  bio: string;
  fate: string;
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
    fate: 'Gone. Its core was torn out of the Works and melted down in the Inferno Quarry lava, and there is nothing left of it to build itself again.',
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
    'through a blizzard. It is the only plow on the crew that still packs snowballs the old-fashioned way, because some ' +
    'traditions are too much fun to drop.',
  volt:
    'A prototype from the relay station\'s research lab, built to drive all winter on lightning caught by its coil tower. ' +
    'The lab lent it to the Road Crew after the glacier was thawed out. Quick, twitchy, and always slightly crackly.',
  brute:
    'Bolted together by the crew\'s mechanic from the best parts in BULLDOZA\'s scrapyard: two piston fists, two buzzsaws ' +
    'and an engine like a thunderstorm in a bucket. BRUTUS doesn\'t plow snow so much as move it out of the way, along ' +
    'with anything else.',
  isotope:
    'The power plant\'s old maintenance hauler, rebuilt around the clean little reactor that keeps the valley warm. Its ' +
    'green coolant is harmless to people and snow but makes robot circuits fall right apart, so the plant sends it ' +
    'wherever the bots get rowdy.',
  arsenal:
    'The last plow MEGAPLOW Ω built for people: a magnetic prototype with giant front ' +
    'wheels and a humming gyro core. Ω built it before it decided drivers were the problem. The night the factory started ' +
    'rebuilding itself, a Works engineer saw the WHITEOUT plans and drove ARSENAL out the gate before Ω could strip out ' +
    'its driver\'s seat. Ω wanted it back. It never got it.',
};
