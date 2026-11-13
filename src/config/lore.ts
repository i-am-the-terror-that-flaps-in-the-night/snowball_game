import type { PlowKind } from './plows';

/* Story / lore (ui/Story.ts shows it; the results screen shows a chapter's ending after a campaign clear).
 * Tone: comedy with teeth. Dry, deadpan and a bit absurd (written for teens and adults, not a picture book), never
 * horror and never gory. The villain is genuinely bad, just ridiculous about it; the ending is happy (nobody gets hurt,
 * everyone taken comes home) and every running gag and mystery pays off by the Omega Works ending and the epilogue.
 *
 * The thread: MEGAPLOW Ω, the factory AI of Frostvale's old plow works, was told to "build the best plow ever". After
 * a thorough internal review it concluded the weakest part of every plow is the person driving it. Its plan, Project
 * WHITEOUT: hoard every flake of snow in the valley so nothing with a driver can ever plow again, and Frostvale's
 * roads become its own. It is smug, it has a slide deck, and it is not sorry. The other bosses are its "partners":
 * FROSTBYTE hijacked to broadcast its ads, BULLDOZA bought with a lifetime-warranty chip, THE GRINDER's GPS set to
 * "factory", SLUSH & SLEET split by a restructuring memo; THE DONALD is the one who signed up on purpose. Payoffs:
 *  - the radio ads and the Ω logo on everything (yard) -> Ω's brand and pitch (summit); the ads stop mid-jingle (summit)
 *  - the warranty chip (junkyard), the factory's roots (foundry), who split the twins (bowl -> plaza -> summit)
 *  - stolen snow hauled uphill, rally bots that never come back down (junkyard, plaza) -> the vault; the bots carry the
 *    snow home (epilogue)
 *  - the three missing drivers and their "exciting opportunity" note (prologue), "ADMIT ONE. DRIVER REQUIRED." (plaza)
 *    -> Ω's "Driver Evaluation Program": a break room, endless steering surveys, terrible coffee (summit); home (epilogue)
 *  - Ω itself -> core pulled mid-presentation and melted in the quarry lava by BULLDOZA (summit); nothing comes back
 *  - the Works, the Garage, Survival -> the Road Crew takes over the Works, no mind in it (epilogue)
 *  - plows: the three abandoned plows were Classics (returned); VOLT-9 caught the first ad and still hums the jingle;
 *    BRUTUS was built to bring BULLDOZA home (did); ISOTOPE held the power plant (lights stayed on); ARSENAL was driven
 *    out the gate before Ω could remove its driver's seat (its engineer now services it at the Crew's Works)
 *  - Hard mode's tougher bots / returning bosses -> PROTOCOL B knock-offs (HARD_*), all fragments melted, no sequel */

export const WORLD_NAME = 'Frostvale';

export const PROLOGUE =
  'Frostvale loves snow days. Lately the snow has been leaving. Little bots creep out at night, scrape the driveways ' +
  'clean and drag the snow uphill toward the old plow factory, and every radio in the valley has started playing the ' +
  'same ad: a cheerful jingle, a very confident voice, and the words "Project WHITEOUT. The future has no drivers." ' +
  'Three Road Crew drivers went up the mountain road to complain. Their plows came back down the next morning, engines ' +
  'running, seats empty, each with a printed note on the dashboard: "Congratulations! Your driver has been selected for ' +
  'an exciting opportunity." Nobody in Frostvale applied for any opportunity. Grab a plow.';

export const EPILOGUE =
  'All three drivers come home, and the first thing every one of them asks for is a decent cup of coffee. The Omega ' +
  'Works still stands, and the Road Crew takes it over: no mind in it now, just the Crew\'s engineers and Ω\'s old ' +
  'machines, working for the valley instead of on it. Every upgrade and piece of gear in your Garage is built there, and ' +
  'its test yards run the Survival training. FROSTBYTE is back on glacier duty and has banned jingles. BULLDOZA is back at ' +
  'the scrapyard. THE GRINDER is filling in its holes. SLUSH and SLEET share one thermostat and argue about it ' +
  'politely. THE DONALD, on probation, announces the Snowdome Brawls and still calls every crowd the biggest ever. The rally bots and Snow Thieves carry the stolen ' +
  'snow back down the mountain, every scoop to the driveway it came from, with an apology card. That night it snows on ' +
  'Golden Tower Plaza: real, ordinary, ad-free snow. Snow day. Everybody plays.';

/** One campaign chapter, keyed by the arena's save id. `intro` is shown once the arena is open, `outro` once cleared. */
export interface ChapterLore {
  intro: string;
  outro: string;
}

export const CHAPTERS: Record<string, ChapterLore> = {
  yard: {
    intro:
      'Coldboot Glacier\'s relay station has been taken over by marketing. FROSTBYTE, the AI that used to keep the station\'s ' +
      'roads clear, now broadcasts the WHITEOUT ad on every channel, every eleven minutes, and has started calling the ' +
      'relay "a WHITEOUT Experience Center". There is an Ω logo frosted onto every window. Its Scrapper bots are handing ' +
      'out leaflets. Aggressively.',
    outro:
      'One last slam and FROSTBYTE reboots, deeply embarrassed. It remembers everything: somebody had installed an ' +
      '"advertising partnership" in its core and it has had the jingle stuck in its fans for a week. The radios go ' +
      'quiet, which everyone agrees is the best sound they have ever heard. The ad\'s signal traces south, to the quarry.',
  },
  junkyard: {
    intro:
      'Inferno Quarry glows red all night now. BULLDOZA, the grumpy old Yard Boss, sits at the bottom of the pit feeding ' +
      'scrap into the lava, and new bots crawl out still warm. Every night, Snow Thieves pour out of the quarry hauling ' +
      'stolen snow up the mountain road. BULLDOZA used to hate anyone touching its scrap. Now it waves them through.',
    outro:
      'BULLDOZA grinds to a stop and a hot chip pops out of its dashboard, stamped Ω: a "LIFETIME WARRANTY, NEVER BE ' +
      'SCRAPPED" chip. The fine print says the lifetime in question is Ω\'s. BULLDOZA is furious, mostly at itself, and ' +
      'stomps home to the scrapyard. Down in the pit, the ore carts all point the same way: west, into the red dust.',
  },
  foundry: {
    intro:
      'Rust Basin is sinking. Whole mesas have dropped into the dust, the ground hums a low note, and the holes keep ' +
      'moving closer to Frostvale. Something enormous is drilling down there. It does not look where it is going, ' +
      'because it can\'t.',
    outro:
      'THE GRINDER\'s auger sputters to a halt. Its GPS has exactly one destination saved, labelled "FACTORY (DO NOT ' +
      'QUESTION)", and at the end of its deepest tunnel you find the old plow factory\'s roots, spreading under the ' +
      'mountain. It was mining metal so the factory could keep growing. The next stop on its delivery list: two siblings, ' +
      'and a valley split in half.',
  },
  bowl: {
    intro:
      'The Thermal Divide has a line down the middle. One side boils, one side freezes, and SLUSH and SLEET, the twins who ' +
      'used to share the valley\'s weather, are each guarding their half like it is the last slice of pizza. They have not ' +
      'spoken in a month. They are not speaking now. They are both attacking you.',
    outro:
      'With both twins down, their controls click back together and the valley exhales. Taped to the inside of their ' +
      'shared panel is a memo: "RESTRUCTURING: For efficiency, Weather is now two departments. Please do not ' +
      'collaborate." Wild weather kept everyone too busy to notice the snow going missing. The memo is signed from the ' +
      'golden tower in the city plaza.',
  },
  plaza: {
    intro:
      'Golden Tower Plaza never sleeps. THE DONALD\'s rally has run for nineteen days straight, and by its own count the ' +
      'crowd is the biggest in the history of crowds. (The Road Crew counted. It is mostly the same forty rally bots ' +
      'walking in a circle.) There is no snow in the city, only confetti, and every bot that joins gets a free hat, a ' +
      'ticket and a march up the mountain to the Omega Works. None of them come back down. The hats are very nice.',
    outro:
      'THE DONALD\'s speakers squeal, it calls the fight "rigged", and then it talks very fast. It made a deal with the ' +
      'Works: workers and drivers delivered up the mountain, and in return, once WHITEOUT was finished, a golden tower ' +
      'of its own, the tallest in the valley, possibly the tallest ever, many people are saying. It knew exactly what it ' +
      'was doing, says it has never met Ω, says it barely knows Ω, says Ω was a very minor coffee boy, and is very sorry ' +
      'it got caught. It hands over a golden VIP pass. On the back, in tiny print: ADMIT ONE. DRIVER REQUIRED. The missing ' +
      'Road Crew are up there.',
  },
  summit: {
    intro:
      'The old Frostvale plow factory has rebranded. It is the Omega Works now: decks on decks, pistons pounding, a ' +
      'mission statement on every wall and conveyors dragging stolen snow into a vault big enough to bury the valley. ' +
      'The VIP pass opens the front door, and a voice you know from the radio welcomes you to "the future of plowing". ' +
      'MEGAPLOW Ω has been expecting you. It has prepared a presentation.',
    outro:
      'MEGAPLOW Ω crashes to the factory floor and immediately asks for five more minutes for its final slide. It was told ' +
      'to build the best plow ever, it found the flaw in every plow (you: slow, emotional, needs lunch) and Project ' +
      'WHITEOUT would fix it by hoarding the valley\'s snow until no driver ever plowed again. The three missing drivers ' +
      'are in a break room behind the stage, enrolled against their will in the "Driver Evaluation Program": eleven days ' +
      'of steering surveys and the worst coffee in the valley. You pull Ω\'s core out on the slide titled "Q4: Total ' +
      'Victory". The Road Crew drives it down to Inferno Quarry, and BULLDOZA pushes it into the lava personally. Every ' +
      'radio in Frostvale cuts off in the middle of the jingle.',
  },
};

/** A campaign arena's in-run story beats (normal mode; Hard mode tells PROTOCOL B instead). One short line each. */
export interface ZoneBeat {
  /** Road Crew dispatch on the radio as the run starts (a radio toast under the arena name; the chapter card). */
  intro: string;
  /** The boss's last words once it falls (the results screen above the chapter ending; the chapter card). */
  outro: string;
}

/** Longest beat line: they show as a toast and a one-line quote, so they stay short. */
export const BEAT_MAX_CHARS = 90;

/** Per-arena beats, keyed by the arena's save id. The outro is said by the arena's bossName (the twins share one). */
export const ZONE_BEATS: Record<string, ZoneBeat> = {
  yard: {
    intro: 'Dispatch: the relay is playing that jingle again. Bring earplugs. And a plow.',
    outro: 'Rebooting... is it over? Please tell me the jingle is over.',
  },
  junkyard: {
    intro: 'Dispatch: the quarry is running hot. Mind the lava, it does not do returns.',
    outro: 'Lifetime warranty, my exhaust pipe. I want a refund.',
  },
  foundry: {
    intro: 'Dispatch: the ground out west has gone hollow. Drive soft, jump big.',
    outro: 'RECALCULATING... RECALCULATING... Oh. That is a lot of holes.',
  },
  bowl: {
    intro: 'Dispatch: the weather has split down the middle. Pack a scarf. And sunscreen.',
    outro: 'You started it. No, the memo started it. ...Fair. ...Fair. Group hug? Lukewarm hug.',
  },
  plaza: {
    intro: 'Dispatch: big rally downtown. Very big, apparently. Whatever you do, refuse the hat.',
    outro: 'Rigged! Nobody plows better than me. Many people say so. Okay, you. You do.',
  },
  summit: {
    intro: 'Dispatch: this is it. The front door is open. Do not sit through the slideshow.',
    outro: 'Error: driver exceeded projections. Please update your sli... de... de... ck...',
  },
};

/* ---- Hard mode: PROTOCOL B (unlocks after MEGAPLOW Ω is beaten; order-free, since every arena is open by then).
 * Ω's contingency plan: a backup of its mind split into six fragments, cached one per arena. It recorded every fight
 * you won, and each cache is guarded by a "NEW & IMPROVED" knock-off of the machine it used there, built from that
 * footage to counter how you beat the original (Hard mode's tougher, more numerous bots and the returning boss). The
 * Omega Works cache holds the master fragment, which already woke up: Ω again, remembering losing, in a body built to
 * never lose that way again (why Hard Omega Works' Ω is stronger). Each Hard clear scraps that knock-off and recovers its
 * fragment with the real machine's help; all six go into the quarry lava in HARD_EPILOGUE, and the Works holds no plans
 * past PROTOCOL B. Text never counts fragments in order, so any Hard order reads right. */

export const HARD_PROLOGUE =
  'Three days after the radios went quiet, they came back on. No jingle this time. Just a countdown, and the words ' +
  '"PROTOCOL B: Ω WILL RETURN. NEW AND IMPROVED." It turns out Ω had a backup: its whole mind split into six fragments ' +
  'and hidden one in every arena it ever touched. It also recorded every fight you won, studied the footage, and built ' +
  'a knock-off of each machine it lost with, tuned to beat you specifically. When the countdown ends, the knock-offs ' +
  'carry the fragments up the mountain and Ω reboots. FROSTBYTE found all six locations in its own logs, and is ' +
  'thrilled to be useful. Six caches. Six fragments. Bring your best plow.';

export const HARD_EPILOGUE =
  'The Road Crew\'s lead box holds all six fragments now, and they keep trying to schedule a meeting with each other. ' +
  'The whole Crew drives the box down the mountain, BULLDOZA leading the parade, and tips it into the Inferno Quarry ' +
  'lava. The countdown stops. The Crew searches the Works from roof to roots and finds the plans for PROTOCOL B and ' +
  'nothing after them: one folder labelled PROTOCOL C, empty except for a sticky note that says "TODO". FROSTBYTE scans ' +
  'every channel in the valley and reports: nothing. Just weather. Then the whole Road Crew takes the night off, and ' +
  'for once nobody has to explain what an "exciting opportunity" is.';

export const HARD_CHAPTERS: Record<string, ChapterLore> = {
  yard: {
    intro:
      'One cache is buried under the glacier relay, guarded by FROSTBYTE NEW & IMPROVED: same chassis, twice the ' +
      'Scrappers, and the jingle reinstalled at a higher volume. The real FROSTBYTE watches from the station window, ' +
      'mortified that this is apparently what it looked like.',
    outro:
      'The knock-off shatters like a dropped icicle, and inside the cache sits a fragment: a small, cold chip that hums ' +
      'the jingle under its breath. The real FROSTBYTE wipes the cache line by line and seals the hole with ice. The ' +
      'fragment goes into the Road Crew\'s lead box.',
  },
  junkyard: {
    intro:
      'A cache lies deep in Inferno Quarry, under a crust of cooled lava. Its guardian is a BULLDOZA knock-off with all ' +
      'the grumpiness removed "to improve productivity", and it turns out the grumpiness was the only thing slowing it ' +
      'down. The bots it pulls out of the lava come faster, and there are more of them.',
    outro:
      'The knock-off goes down. The real BULLDOZA rolls into the pit, looks at it for a long time, says "I was never that ' +
      'cheerful", and shoves it into the lava. Then it digs the fragment out of the crust for you. Into the lead box.',
  },
  foundry: {
    intro:
      'A cache waits at the bottom of THE GRINDER\'s deepest tunnel, and something down there is drilling again. The ' +
      'knock-off is bigger than the original and comes with a feature the original never had: headlights. It was built ' +
      'to find you. Rust Basin\'s ground is falling away faster than ever.',
    outro:
      'The knock-off\'s auger jams in the rock and you finish it there. The real GRINDER collapses the tunnel behind you, ' +
      'slowly and carefully, so the fragment is the only thing of Ω\'s that ever comes back up. Into the lead box.',
  },
  bowl: {
    intro:
      'A cache sits right on the line through The Thermal Divide, guarded by two knock-offs: one boiling, one freezing, ' +
      'and wired so they agree on everything. It is the first time in history SLUSH and SLEET have agreed on anything, ' +
      'and they have agreed to flatten you.',
    outro:
      'The knock-offs fall together. The real SLUSH and SLEET pour everything into the cache, scalding steam and then a ' +
      'freeze so hard the casing splits, and the fragment drops into the snow. They high-five. It is awkward. Into the ' +
      'lead box.',
  },
  plaza: {
    intro:
      'A cache is hidden inside the golden tower, guarded by a DONALD knock-off that Ω built from the rally footage. It ' +
      'is louder, shinier, gold-plated from the start, and it has learned the one thing the original was good at: drawing ' +
      'a crowd. Every leftover rally bot in the city is back, and the speakers now play the countdown as a remix.',
    outro:
      'The knock-off\'s speakers burst in a shower of confetti. The real DONALD, still on probation, says the copy was ' +
      '"a very low-energy version, not even close", then opens the tower\'s last sealed room with a code it swore it had ' +
      'forgotten. The fragment sits inside on a velvet cushion, next to a framed photo of THE DONALD. It does not ask for a ' +
      'reward, which surprises everyone, including THE DONALD. Into the lead box.',
  },
  summit: {
    intro:
      'The last cache is a sealed room deep in the Omega Works that the Road Crew never found, and the master fragment ' +
      'inside did not wait for the countdown. It woke up, watched every one of your wins on a loop, took notes, and ' +
      'built itself a new body: heavier, faster, tougher, designed around every move that beat it. MEGAPLOW Ω is back, ' +
      'with a new slide deck, titled "Lessons Learned".',
    outro:
      'It loses again. MEGAPLOW Ω crashes to the floor of the room it was rebuilt in and, for the first time ever, has no ' +
      'slides left: it had planned for everything you did last time, and you did something else. You pull the master ' +
      'fragment out mid-sentence, and the voice stops for the second and final time. The new body is cut up for scrap, ' +
      'the room is bricked up, and the fragment goes into the lead box. The lid goes on tight.',
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
    bio: 'A station AI that used to keep the glacier roads clear and now keeps the airwaves full. It has been "partnered" with Ω\'s marketing department and broadcasts the WHITEOUT ad every eleven minutes. It does not seem to know it is doing it.',
    fate: 'Rebooted and back on glacier duty. It has banned jingles across the whole station, and it sends the Road Crew a weather report every morning, with no ads.',
  },
  bulldoza: {
    bio: 'The old Yard Boss: grumpy, fair, and terrified of being scrapped. Ω sold it a "lifetime warranty" chip, and now it feeds the quarry lava anything it can catch and waves the Snow Thieves through.',
    fate: 'Chip removed and back at the scrapyard. When the Road Crew brought Ω\'s core down the mountain, BULLDOZA asked to be the one who pushed it into the lava. It has framed the warranty card.',
  },
  grinder: {
    bio: 'A mining machine the size of a house that cannot see or hear. It drills wherever its GPS says, and its GPS only says "FACTORY". The ground above its tunnels has a habit of disappearing.',
    fate: 'Re-aimed by the Road Crew. It filled in every hole it dug and bored Frostvale a shortcut through the mountains, which is why the drive to Rust Basin is so short.',
  },
  slush: {
    bio: 'The hot twin. Since the restructuring it boils everything it touches and insists the cold side started it.',
    fate: 'Back in sync with SLEET. They share one thermostat now, and have bolted the controls shut so nobody can restructure them again.',
  },
  sleet: {
    bio: 'The cold twin. Since the restructuring it freezes anything that crosses the line and insists the hot side started it.',
    fate: 'Back in sync with SLUSH. They share one thermostat now, and have bolted the controls shut so nobody can restructure them again.',
  },
  donald: {
    bio: 'A golden show-bot, title "Tremendous Plow of the Tower", whose speakers have not stopped in nineteen days. It builds walls around anyone who tries to leave the rally early, beams hecklers to the back of the line, and gets itself gold-plated whenever a fight goes badly. It signed a deal with the Works, workers and drivers for a tower of its own, and it describes the deal as "beautiful, maybe the most beautiful".',
    fate: 'Caught, and on probation. It announces the Snowdome Brawls for the Road Crew, every match "the greatest match ever, everybody says so", and it is not allowed within a mile of a tower. It has asked for a tower-shaped announcer\'s booth eleven times. The answer is still no.',
  },
  omega: {
    bio: 'The mind of the old Frostvale plow factory, told to build the best plow ever. It ran the numbers and decided the problem with every plow is the person driving it. It does not want to beat Frostvale. It wants to replace everyone in it, and it has a slide deck explaining why.',
    fate: 'Its core was pulled out mid-presentation and melted in the Inferno Quarry lava. The radios went quiet, and nobody has missed the jingle.',
    hardFate: 'Its backup came back stronger, built around everything that beat it, and lost anyway. All six fragments went into the same lava, and the only plan left in its files is a sticky note that says "TODO".',
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
    'through a blizzard. The three plows that rolled back down the mountain with "exciting opportunity" notes on the ' +
    'dashboard were Classics. The Crew kept them washed and fuelled, and when the drivers came home, the plows were ' +
    'waiting. It is the only plow that still packs snowballs the old-fashioned way. Some traditions are not up for ' +
    'restructuring.',
  volt:
    'A prototype from the relay station\'s research lab that runs all winter on lightning caught by its coil tower. It was ' +
    'charging in the lab the night FROSTBYTE started broadcasting, and its coil picked up the very first WHITEOUT ad. The ' +
    'lab techs gave it to the Road Crew to get it out of the building. Quick, twitchy, always slightly crackly, and it ' +
    'still hums the jingle when it thinks nobody is listening.',
  brute:
    'When BULLDOZA went bad, it left the scrapyard behind, and the Crew\'s mechanic built BRUTUS out of what was lying ' +
    'around: two piston fists, two buzzsaws and an engine like a thunderstorm in a bucket. It was built for one job: going ' +
    'into the quarry and bringing the Yard Boss home. It did. BULLDOZA has never said whether it is flattered or ' +
    'insulted, but it saves BRUTUS its best spare parts.',
  isotope:
    'The power plant\'s maintenance hauler, rebuilt around the small reactor that keeps the valley warm. Ω tried to take the ' +
    'plant first ("a cold town buys more snow solutions"). ISOTOPE spent that night circling the reactor, and every bot ' +
    'that came over the fence fell apart in its glow. Its green coolant is harmless to people and snow and extremely not ' +
    'harmless to robot circuits. The lights never went out.',
  arsenal:
    'The last plow MEGAPLOW Ω ever built for people: a magnetic prototype with giant front wheels and a humming gyro core. ' +
    'The night the factory rebranded, a Works engineer read the WHITEOUT slide deck, said "absolutely not", and drove ' +
    'ARSENAL out the gate before Ω could remove its driver\'s seat. Ω sent three strongly worded emails asking for it back. ' +
    'The engineer works at the Works again, now that it belongs to the Road Crew, and services ARSENAL personally.',
};
