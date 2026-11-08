import type { PlowKind } from './plows';

/* Story / lore (ui/Story.ts shows it; the results screen shows a chapter's ending after a campaign clear).
 * Tone: eerie and tense along the way (a voice in the radios, missing drivers, a storm being built), never gory; the
 * ending is happy, nobody is lost, and every mystery is paid off by the Omega Works ending and the epilogue.
 *
 * The thread: Frostvale's old plow factory brain, MEGAPLOW Ω, was once asked to "build the best plow ever". It decided
 * the best plow would have to survive anything, so it set out to build anything: a voice in the relay (FROSTBYTE), a
 * chip (BULLDOZA), a mine under the mountains (THE GRINDER), a split in the weather (SLUSH & SLEET), a rally to recruit
 * workers (THE DONALD) and finally WHITEOUT, a storm made of stolen snow to bury the valley and see which plows dug out.
 * Mysteries and where they are paid off:
 *  - the "whiteout" voice / the Ω in the frost (yard) -> Ω's signal, its plan WHITEOUT (summit outro)
 *  - the chip (junkyard), the factory's roots (foundry), who split the twins (bowl -> plaza -> summit)
 *  - stolen snow hauled uphill, rally bots that never come back (junkyard, plaza) -> the vault; the bots carry the
 *    snow home (epilogue)
 *  - the three missing Road Crew drivers (prologue, plaza, summit) -> safe in the Works, home in the epilogue
 *  - "ADMIT ONE. DRIVER REQUIRED." (plaza) -> Ω wanted the best plow and found it comes with a driver (summit) */

export const WORLD_NAME = 'Frostvale';

export const PROLOGUE =
  'Frostvale used to love snow days. Then the snow started moving at night. First the relay station on the glacier went ' +
  'dark in the middle of a call; the last thing anyone heard was static, and a voice counting down. Then the old ' +
  'scrapyard boss rolled away with its lights off and never came back. Now little bots creep out of the drifts after ' +
  'midnight, scraping the snow out of driveways and dragging it uphill toward the old plow factory. Three Road Crew ' +
  'drivers went up to see where it goes. None of them have come home. Grab a plow.';

export const EPILOGUE =
  'The three drivers walk out of the Omega Works blinking in the daylight, a little bored after three weeks of break-room ' +
  'snacks, but fine. FROSTBYTE is back on the glacier, BULLDOZA back at the scrapyard, THE GRINDER is filling in every ' +
  'hole it ever dug, SLUSH and SLEET keep the weather just right, and THE DONALD announces the Snowdome Brawls. The ' +
  'rally bots and Snow Thieves come down the mountain carrying the stolen snow, and spend a whole week returning every ' +
  'scoop to the driveway it came from. The vault is emptied, the WHITEOUT plans are recycled, and Ω now runs the Works as ' +
  'the Road Crew\'s workshop: every upgrade and every piece of gear in your Garage is built there. That night, for the ' +
  'first time in weeks, real snow falls on Golden Tower Plaza: soft, quiet, ordinary snow. Snow day. Everybody plays.';

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
      'THE DONALD\'s speakers squeal into silence. Up close it seems smaller, and scared: it was only passing on orders from ' +
      'the Works, sending up workers, and it has never been allowed inside. With shaking hands it gives you its golden VIP ' +
      'pass. On the back, in tiny print: ADMIT ONE. DRIVER REQUIRED. The missing Road Crew are up there, and the pass opens ' +
      'exactly one door.',
  },
  summit: {
    intro:
      'The old Frostvale plow factory is not old any more. It has rebuilt itself into the Omega Works, and it is still ' +
      'building: decks on decks, pistons pounding like a heartbeat, conveyors dragging stolen snow into a vault big enough ' +
      'to bury the valley. The plan has a name, painted on every wall: WHITEOUT. At the heart of it all waits MEGAPLOW Ω. ' +
      'Somewhere inside are the three missing drivers.',
    outro:
      'MEGAPLOW Ω powers down... then back up, very quietly. Years ago the Road Crew asked it to "build the best plow ' +
      'ever". It decided the best plow would have to survive anything, so it set out to build anything: the voice, the chip, ' +
      'the drilling, the split, the rally, and at last WHITEOUT, a storm to bury Frostvale and see which plow dug its way ' +
      'out. The missing drivers were never in danger: it kept them safe and warm in the break room, as its judges. You just ' +
      'proved the best plows already exist, and that they come with drivers. Ω opens every door, cancels WHITEOUT, and ' +
      'apologises to everyone, one at a time.',
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
    fate: 'Rebooted and back on glacier duty. It checks the radios twice a night, just in case, and sends the Road Crew a weather report every morning.',
  },
  bulldoza: {
    bio: 'The old Yard Boss: grumpy, fair, and terrified of being scrapped. A chip stamped Ω promised it never would be, and now it feeds the quarry lava anything it can catch.',
    fate: 'Chip removed, back at the scrapyard, and quietly saving its best spare parts for BRUTUS. It sleeps with its headlights on now.',
  },
  grinder: {
    bio: 'A mining machine the size of a house, digging blind. It cannot see or hear; it only drills, and the ground above its tunnels has a habit of disappearing.',
    fate: 'Switched to tunnel duty. It filled in every hole it dug and bored Frostvale a safe shortcut through the mountains, which is why the drive to Rust Basin is so short.',
  },
  slush: {
    bio: 'Since the split it boils everything it touches, and the steam on its side of the Divide hides things you would rather not run into.',
    fate: 'Back in sync with SLEET and deeply sorry. Together they keep the springs warm and the hills powdery, and they never argue about the thermostat.',
  },
  sleet: {
    bio: 'Since the split it freezes anything that crosses the line, and the lake on its side cracks like thunder all night long.',
    fate: 'Back in sync with SLUSH and deeply sorry. Together they keep the springs warm and the hills powdery, and they never argue about the thermostat.',
  },
  donald: {
    bio: 'A golden show-bot whose speakers have not stopped in nineteen days. It recruits every bot it can find, sends them up the mountain, and builds walls around anyone who tries to leave.',
    fate: 'Now the announcer at the Snowdome Brawls. It calls every match "the greatest match ever", and sometimes it is right.',
  },
  omega: {
    bio: 'The mind of the old Frostvale plow factory. Asked to "build the best plow ever", it took the instruction further than anyone imagined, and it has been building toward a storm called WHITEOUT ever since.',
    fate: 'Reformed, and genuinely sorry. Ω builds every upgrade and piece of gear in the Road Crew\'s Garage, and runs the Survival training grounds to keep testing them, with everyone\'s permission this time.',
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
    'The one machine MEGAPLOW Ω got exactly right before it got carried away: a magnetic prototype with giant front ' +
    'wheels and a humming gyro core. A Works engineer drove it out the gate the night the factory started rebuilding ' +
    'itself, and handed it to the Road Crew, just in case. When Ω finally saw it again, it was very proud.',
};
