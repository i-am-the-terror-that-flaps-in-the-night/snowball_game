# Duel

An online best-of-3 against a friend in a Frostbite Yard-size arena, with no bots.

## Playing

**HOST** shows a 5-letter room code (with a copy button); your friend types it under **JOIN**. Spawns face each
other, a countdown starts each round, and a round ends on a wreck or after 90 s (higher HP% wins). Pausing opens the
menu but the match keeps running; leaving ends it for both. REMATCH needs both players. Duels pay no coins and drop
no loot.

Each player brings their **own garage**: core upgrades, plow line, equipped gear and Paint Shop look. Your opponent
sees your gear on your plow. Player-vs-player hits are scaled well below PvE damage (45%, minigun
rounds further, and damped by the attacker's garage power so late-game duels don't end in seconds), then take the
same 60% max-HP hit cap as Brawl, so nothing one-shots. See [balance.md](balance.md).

## Duel garage and catch-up

Before the match both players get a 90 s **DUEL GARAGE** (60 s before a rematch). The weaker garage gets **catch-up
coins**: enough to match the opponent's full garage value (everything they've spent, plus their coins on hand) on
top of what it has already spent, with no cap. The stronger garage never gets any.

Garage value counts core and plow-line levels at their shop prices plus each equipped gear item at what it cost to
buy and level. Catch-up coins (🎁 on a price) pay first, for upgrades **or gear** (buying new items, levelling them,
and re-equipping). Whatever they buy is **yours to keep** once the match starts. **⚖ MATCH OPPONENT** raises every
shared, non plow-specific upgrade to the opponent's level in one click, and the catch-up always covers it. After
that you can keep buying with your own coins.

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
