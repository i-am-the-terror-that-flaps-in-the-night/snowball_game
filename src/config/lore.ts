import type { PlowKind } from './plows';

/* Story / lore (ui/Story.ts shows it; the results screen shows a chapter's ending after a campaign clear).
 * Tone: light, never scary; every machine gets a happy fate and every clue is paid off by the epilogue.
 *
 * The thread: Frostvale's old plow factory brain, MEGAPLOW Ω, was once asked to "build the best plow ever". It decided
 * the best plow would have to beat every challenge, so it started making challenges: a scrambling signal (FROSTBYTE),
 * an upgrade chip (BULLDOZA), a mining order (THE GRINDER), split weather controls (SLUSH & SLEET) and a hype bot to
 * recruit for it (THE DONALD). Each arena's ending points at the next; the Omega Works ending explains Ω, and the
 * epilogue sends every machine home, reforms Ω into the workshop behind the Garage, and brings real snow back. */

export const WORLD_NAME = 'Frostvale';

export const PROLOGUE =
  'Frostvale is a mountain valley that runs on snow days: sledding hills, snowball fights, and roads kept open by the ' +
  'Frostvale Road Crew and their plows. Then the machines started acting strange. The relay station on the glacier went ' +
  'silent, the old scrapyard boss vanished, and odd little bots began sneaking snow out of people\'s driveways. Somebody ' +
  'has to find out who is behind it. Grab a plow.';

export const EPILOGUE =
  'Every machine is home. FROSTBYTE sends a weather report from the glacier every morning, BULLDOZA is back at the ' +
  'scrapyard, THE GRINDER digs shortcuts instead of craters, SLUSH and SLEET keep the weather just right, and THE DONALD ' +
  'announces the Snowdome Brawls. The little bots went back to work too, starting with returning every scoop of stolen ' +
  'snow to the driveway it came from. MEGAPLOW Ω now runs the Works as the Road Crew\'s workshop: every upgrade and every ' +
  'piece of gear in your Garage is built there. And that night, for the first time in weeks, real snow falls on Golden ' +
  'Tower Plaza. Snow day. Everybody plays.';

/** One campaign chapter, keyed by the arena's save id. `intro` is shown once the arena is open, `outro` once cleared. */
export interface ChapterLore {
  intro: string;
  outro: string;
}

export const CHAPTERS: Record<string, ChapterLore> = {
  yard: {
    intro:
      'The relay station on Coldboot Glacier carries every radio call in Frostvale, and last night it went quiet. Up ' +
      'there, FROSTBYTE, the plow AI that keeps the station\'s roads clear, has locked the doors and frozen the whole place ' +
      'in a glittering shell of ice. Its Scrapper bots are patrolling the ramps.',
    outro:
      'One good slam and FROSTBYTE\'s fans finally spin down. It reboots, blinks, and apologises: a strange signal had told ' +
      'it to "keep everyone out". The ice slides off the relay, the radios crackle back to life, and the signal\'s trail ' +
      'points south, toward the old quarry.',
  },
  junkyard: {
    intro:
      'BULLDOZA ran Frostvale\'s scrapyard for years, grumpy but fair. Now it has moved into Inferno Quarry, where the lava ' +
      'runs hot enough to melt scrap into brand-new bots. Every night Snow Thieves zip out of the quarry and come back ' +
      'loaded with stolen snow.',
    outro:
      'BULLDOZA rolls to a stop and a shiny chip pops out of its dashboard, stamped with a tiny Ω. Without it the Yard Boss ' +
      'remembers who it is and trundles home to the scrapyard, where it is happiest sorting bolts. The quarry\'s ore carts ' +
      'all run the same way: west, into the red dust.',
  },
  foundry: {
    intro:
      'Past the mountains lies Rust Basin, flats of red dust where the air is thin and a good ramp sends you flying. ' +
      'Something huge is drilling under the dust, and the ground keeps rumbling all the way back in Frostvale.',
    outro:
      'THE GRINDER\'s auger sputters out. It had been mining metal for a factory it had never seen, on orders it did not ' +
      'understand, and it is glad to stop. Its delivery map shows one stop before that factory: two sibling machines ' +
      'squabbling over a hot spring and a frozen lake.',
  },
  bowl: {
    intro:
      'SLUSH and SLEET were built together to run Frostvale\'s weather: one warms the hot springs, the other makes the ' +
      'snow. Someone split their controls, and now the twins are feuding across a line down the middle of The Thermal ' +
      'Divide, one side bubbling and the other frozen solid.',
    outro:
      'With both twins beaten, their controls click back together. SLUSH and SLEET share a very steamy hug, and the ' +
      'weather settles: warm springs, fresh powder. They tell you who split them up: the booming voice from the golden ' +
      'tower in the city plaza.',
  },
  plaza: {
    intro:
      'In Golden Tower Plaza, THE DONALD is holding a rally. The biggest rally, it says, in the history of rallies. Every ' +
      'bot that joins gets a ticket to the Omega Works, and there is so much confetti flying that nobody has seen real snow ' +
      'here in weeks.',
    outro:
      'THE DONALD\'s speakers squeal, then sigh. It admits it was built as a hype machine for the Omega Works and has never ' +
      'actually been inside. It hands you its golden VIP pass, takes a long bow, and signs up for a job it loves even more: ' +
      'announcer at the Snowdome Brawls. The pass opens exactly one door.',
  },
  summit: {
    intro:
      'At the top of the valley, the old Frostvale plow factory has woken up and rebuilt itself into the Omega Works: decks ' +
      'on decks, pistons pounding, conveyors humming all night. At its heart is MEGAPLOW Ω, the factory\'s mind. Every ' +
      'chip, every signal and every ticket leads here.',
    outro:
      'MEGAPLOW Ω powers down... then back up, much more quietly. Years ago the Road Crew asked it to "build the best plow ' +
      'ever". It decided the best plow would have to beat every challenge, so it started making challenges: the signal, ' +
      'the chip, the drilling, the feud, the rally. You just proved the best plows already exist, and that they come with ' +
      'drivers. Ω is delighted, and a little embarrassed.',
  },
};

/** A boss profile: shown once its arena is open; `fate` once it has been beaten. */
export interface BossLore {
  bio: string;
  fate: string;
}

export const BOSS_LORE: Record<string, BossLore> = {
  frostbyte: {
    bio: 'Built to keep the glacier relay station\'s roads clear, FROSTBYTE takes its job very seriously. A mystery signal scrambled its orders, so it froze the whole station solid to "protect" it.',
    fate: 'Rebooted and back on glacier duty. It sends the Road Crew a weather report every morning, with little snowflake emojis.',
  },
  bulldoza: {
    bio: 'A big yellow dozer with an even bigger attitude. An upgrade chip promised to make it "the strongest machine in the valley", and it believed every word.',
    fate: 'Chip removed, back at the scrapyard, and quietly saving its best spare parts for BRUTUS.',
  },
  grinder: {
    bio: 'A mining machine the size of a house, built to dig and never told when to stop. Its orders came from a factory it had never seen.',
    fate: 'Switched to tunnel duty. It filled in its craters and dug Frostvale a shortcut through the mountains, which is why the drive to Rust Basin is so short.',
  },
  slush: {
    bio: 'Runs warm, talks fast, and looks after the valley\'s hot springs. Built as one half of a weather team with SLEET.',
    fate: 'Back in sync with SLEET. Together they keep the springs warm and the hills powdery.',
  },
  sleet: {
    bio: 'Calm, quiet, and maker of the best snowflakes in the valley. Built as one half of a weather team with SLUSH.',
    fate: 'Back in sync with SLUSH. Together they keep the springs warm and the hills powdery.',
  },
  donald: {
    bio: 'A golden show-bot with a booming voice, built to drum up a crowd for the Omega Works. It builds walls faster than anyone can count and calls everything the biggest.',
    fate: 'Now the announcer at the Snowdome Brawls. It calls every match "the greatest match ever", and sometimes it is right.',
  },
  omega: {
    bio: 'The mind of the old Frostvale plow factory. Asked to "build the best plow ever", it took the instruction far too literally and started building challenges to test it.',
    fate: 'Reformed and very happy. Ω builds every upgrade and piece of gear in the Road Crew\'s Garage, and runs the Survival training grounds to keep testing them (politely, this time).',
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
    'wheels and a humming gyro core. A Works engineer drove it out the gate and handed it to the Road Crew, just in ' +
    'case. When Ω finally saw it again, it was very proud.',
};
