# Duel

An online best-of-3 against a friend in a **shrunk Snowdome**: Brawl's venue (stands, cover, deep drifts, the six
biome variants) at Duel size, 120 m across (`DUEL_ARENA_HALF` 60, two thirds of the 180 m dome), with no bots and no
coins. The cover, stands, floodlights and drifts scale with the arena (`domeK` in `src/world/environment/layout.ts`;
the giant snowman statues get their own spot, `DUEL_DOME_SNOWMAN`, as scaled they stood beside the follow camera at both
spawns);
the ground terrain has its own Duel layout (`DUEL_DOME_TERRAIN` in `src/world/biomes/terrains.ts`). Both peers derive
the venue from the room code (`duelVenueFor` in `src/config/duel.ts`), so it needs no protocol message.

## Playing

**HOST** shows a 5-letter room code (with a copy button); your friend types it under **JOIN**. Spawns face each
other 50 m apart across the fountain (0 / ±25), a countdown starts each round, and a round ends on a wreck or after
90 s (higher HP% wins). Pausing opens the
menu but the match keeps running; leaving ends it for both. REMATCH needs both players. Duels pay no coins and drop
no loot.

Each player brings their **own garage**: core upgrades, plow line, equipped gear and Paint Shop look. Your opponent
sees your gear on your plow. Player-vs-player hits are scaled well below PvE damage (45%, minigun
rounds further, and damped by the attacker's garage power so late-game duels don't end in seconds), then take the
same 60% max-HP hit cap as Brawl, so nothing one-shots. On top of that each vehicle has a Duel-only factor on the
damage it deals and on the damage it takes (`DUEL_KIND_DAMAGE` / `DUEL_KIND_TAKEN` in `src/config/duel.ts`: VOLT-9
deals x1.8 and takes x0.77, ARSENAL deals x0.85 and takes x0.62, ISOTOPE takes x0.9, BRUTUS deals x0.62 and takes
x1.15, the Classic deals x0.92), measured on real autopiloted duels so that no vehicle wins far more than half its
matchups; campaign, Survival and Brawl never see them. See [balance.md](balance.md) ("Duel balance at high").

**Ultimates** (FIRESTORM, SUPERCELL, EARTHQUAKE, NUKE, SINGULARITY) fire in the Duel too. There the meter is sized in
the opponent's HP instead of in damage: it fills once the damage that counts toward it adds up to `DUEL_ULT_CHARGE`
(2.5) x the opponent's max HP (ISOTOPE x0.65, BRUTUS x1.25, Overclock / sqrt(cooldownMult)), which is the same at every
garage tier. In an even same-tier fight the first ultimate comes about 30-45 s into continuous fighting, and the meter
**carries over between rounds** (it is empty at match start), so it is typically ready about once per round. An
ultimate landing on a human goes through the normal Duel damage path, and its damage (blast and aftermath) is also
soft-capped at `DUEL_ULT_HP_CAP` (35%) of the victim's max HP per ultimate: measured on a parked same-tier plow it
takes about 20-45%. The host owns both meters (they ride in the snapshot) and fires both players' ultimates.

## Duel garage and catch-up

Before the match both players get a 90 s **DUEL GARAGE** (60 s before a rematch). The weaker garage gets **catch-up
coins**: enough to match the opponent's full garage value (everything they've spent, plus their coins on hand) on
top of what it has already spent, with no cap. The stronger garage never gets any.

Garage value counts core and plow-line levels at their shop prices plus every equipped gear item (any number of
them) at what it cost to buy and level. Catch-up coins (🎁 on a price) pay first, for upgrades **or gear** (buying new items, levelling them,
and re-equipping). Whatever they buy is **yours to keep** once the match starts. Don't want to shop? **⚡ AUTO-SPEND**
spends all of it in one click: first it raises every shared, non plow-specific upgrade to the opponent's level
(the catch-up always covers that), then it spreads the rest evenly, always buying the cheapest next step among
the core upgrades, your plow's line, levelling your equipped gear and buying (and equipping) gear you don't own yet.
Owned items you took off stay off. Items that do nothing in a duel (Lucky Magnet, Snow Globe) are skipped. You can still shop
by hand before or after, and then keep buying with your own coins.

## Netcode

- Host-authoritative: the host simulates both plows and sends binary snapshots; the guest sends inputs (including a
  held-button mask) and predicts its own plow. The host computes both players' stats from the levels they bring.
- Transport: PeerJS (WebRTC data channels over the free public PeerJS signalling server, Google STUN). Add
  `?duel=local` to duel between two tabs of one browser instead (BroadcastChannel; `&lag=80&jitter=30&loss=0.05`
  fakes a bad link).
- **NAT traversal / TURN.** Out of the box the game uses public STUN servers, which connect players as long as at
  least one side has an ordinary home-router NAT. Two players on strict NATs (school, office and mobile-carrier
  networks, some routers) will find each other's room but then fail with "couldn't connect to the host". Those need
  a **TURN relay**: copy `.env.example` to `.env.local`, fill in a TURN server's URLs and credentials (any provider,
  e.g. a free Metered Open Relay account, or your own coturn), and rebuild / restart `npm run dev`. Both players
  must run a build that has the relay. Relay credentials end up in the page, so use relay-only ones. Quick
  workaround without a relay: one player switches network (a phone hotspot usually works).
- The wire format is in `src/net/protocol.ts`. Both sides must run the same `PROTOCOL_VERSION`; a mismatch is
  refused with a message.
