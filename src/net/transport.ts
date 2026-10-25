/* ------------------------------------------------------------------------------------------------
 * DUEL transports: one host, one guest, two logical channels.
 *   - reliable:   ordered + retransmitted (handshake, round flow, hit / ability events, snow patches)
 *   - unreliable: latest-wins (host snapshots, guest input) — may drop or reorder; the protocol copes.
 *
 * Two implementations:
 *   - PeerJS (WebRTC data channels; signalling through the free public PeerJS cloud server, Google STUN). The host
 *     registers the peer id `snowplow-duel-<CODE>`; the guest connects to it. Two DataConnections: 'rel'
 *     (reliable) and 'unrel' (unordered). Loaded lazily, so single-player never downloads PeerJS.
 *   - BroadcastChannel ('local'): same-origin tabs / pages of one browser. Used by the headless duel probe and
 *     handy for local testing (?duel=local). Optional artificial lag / jitter / loss for netcode testing.
 * ---------------------------------------------------------------------------------------------- */

export type Payload = string | ArrayBuffer;
export type TransportKind = 'peer' | 'local';

export interface Transport {
  readonly kind: TransportKind;
  /** `reliable` false = may be dropped (snapshots, input). */
  send(data: Payload, reliable: boolean): void;
  onMessage: ((data: Payload) => void) | null;
  /** The other side went away or the link broke (not called for our own close()). */
  onClose: ((reason: string) => void) | null;
  close(): void;
  readonly open: boolean;
}

export type NetErrorCode = 'not-found' | 'full' | 'unavailable' | 'network' | 'timeout' | 'unsupported' | 'cancelled';

export class NetError extends Error {
  constructor(readonly code: NetErrorCode, message: string) {
    super(message);
  }
}

/** A room being hosted: show `code`, then await the guest. */
export interface HostRoom {
  readonly code: string;
  readonly kind: TransportKind;
  /** Resolves when a guest connects (one guest per room; later ones are told the room is full). */
  waitForGuest(): Promise<Transport>;
  /** Stop hosting (rejects a pending waitForGuest with 'cancelled'). */
  cancel(): void;
}

/* ------------------------------------------------------------------ room codes */

/** Unambiguous letters only: no I/L (1), O (0), S (5), Z (2), B (8), U/V. */
export const ROOM_ALPHABET = 'ACDEFGHJKMNPQRTWXY';
export const ROOM_CODE_LEN = 5;
export const PEER_PREFIX = 'snowplow-duel-';

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  return s;
}

/** Clean up what the player typed: upper-case, letters only. Null unless it is a full, valid code. */
export function normalizeRoomCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length !== ROOM_CODE_LEN) return null;
  for (const c of s) if (!ROOM_ALPHABET.includes(c)) return null;
  return s;
}

/* ------------------------------------------------------------------ BroadcastChannel */

interface LocalMsg {
  k: 'claim' | 'taken' | 'hello' | 'welcome' | 'full' | 'd' | 'bye';
  from: string;
  to?: string;
  data?: Payload;
}

export interface LocalLinkOpts {
  /** One-way delay in ms, plus up to `jitter` ms random extra (unreliable messages may reorder). */
  lag?: number;
  jitter?: number;
  /** 0..1 chance an unreliable message is dropped. */
  loss?: number;
}

const randId = () => Math.random().toString(36).slice(2, 10);

class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  onMessage: ((data: Payload) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private _open = true;
  private lastReliableAt = 0;

  constructor(
    private ch: BroadcastChannel,
    private me: string,
    private peer: string,
    private opts: LocalLinkOpts,
    private release: () => void,
  ) {}

  get open(): boolean {
    return this._open;
  }

  send(data: Payload, reliable: boolean): void {
    if (!this._open) return;
    const lag = this.opts.lag ?? 0;
    const jitter = this.opts.jitter ?? 0;
    if (!reliable && (this.opts.loss ?? 0) > 0 && Math.random() < (this.opts.loss ?? 0)) return;
    // structured clone copies `data` now, so callers may reuse their buffers.
    const msg: LocalMsg = { k: 'd', from: this.me, to: this.peer, data };
    if (lag <= 0 && jitter <= 0) {
      this.ch.postMessage(msg);
      return;
    }
    const copy = typeof data === 'string' ? data : data.slice(0);
    msg.data = copy;
    const now = performance.now();
    let at = now + lag + Math.random() * jitter;
    // Reliable = ordered: never overtake an earlier reliable message.
    if (reliable) at = this.lastReliableAt = Math.max(at, this.lastReliableAt + 0.01);
    setTimeout(() => this._open && this.ch.postMessage(msg), Math.max(0, at - now));
  }

  /** From the room / join listener. */
  deliver(m: LocalMsg): void {
    if (!this._open) return;
    if (m.k === 'bye') {
      this.shutdown();
      this.onClose?.('closed');
      return;
    }
    if (m.k === 'd' && m.data !== undefined) this.onMessage?.(m.data);
  }

  close(): void {
    if (!this._open) return;
    try {
      this.ch.postMessage({ k: 'bye', from: this.me, to: this.peer } satisfies LocalMsg);
    } catch {
      /* channel closed */
    }
    this.shutdown();
  }

  private shutdown(): void {
    this._open = false;
    this.release();
  }
}

/** Host a BroadcastChannel room. `code` is claimed first: another tab already hosting it answers 'taken'. */
export async function hostLocal(code: string | null, opts: LocalLinkOpts = {}): Promise<HostRoom> {
  if (typeof BroadcastChannel === 'undefined') throw new NetError('unsupported', 'This browser has no BroadcastChannel.');
  for (let attempt = 0; attempt < 6; attempt++) {
    const c = code && attempt === 0 ? code : makeRoomCode();
    const ch = new BroadcastChannel(`snowplow-duel:${c}`);
    const me = randId();
    const taken = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 250);
      ch.onmessage = (e: MessageEvent<LocalMsg>) => {
        if (e.data?.k === 'taken' && e.data.to === me) {
          clearTimeout(t);
          resolve(true);
        }
      };
      ch.postMessage({ k: 'claim', from: me } satisfies LocalMsg);
    });
    if (taken) {
      ch.close();
      if (code && attempt === 0) code = null;
      continue;
    }
    return localRoom(ch, c, me, opts);
  }
  throw new NetError('unavailable', 'Could not find a free room code.');
}

function localRoom(ch: BroadcastChannel, code: string, me: string, opts: LocalLinkOpts): HostRoom {
  let link: LocalTransport | null = null;
  let guestId = '';
  let resolveGuest: ((t: Transport) => void) | null = null;
  let rejectGuest: ((e: Error) => void) | null = null;
  let cancelled = false;
  const pending = new Promise<Transport>((res, rej) => {
    resolveGuest = res;
    rejectGuest = rej;
  });
  pending.catch(() => {});
  const closeAll = () => {
    cancelled = true;
    ch.close();
  };
  ch.onmessage = (e: MessageEvent<LocalMsg>) => {
    const m = e.data;
    if (!m || m.from === me) return;
    if (m.k === 'claim') {
      ch.postMessage({ k: 'taken', from: me, to: m.from } satisfies LocalMsg);
      return;
    }
    if (m.k === 'hello') {
      if (link) {
        if (m.from !== guestId) ch.postMessage({ k: 'full', from: me, to: m.from } satisfies LocalMsg);
        return;
      }
      guestId = m.from;
      link = new LocalTransport(ch, me, m.from, opts, closeAll);
      ch.postMessage({ k: 'welcome', from: me, to: m.from } satisfies LocalMsg);
      resolveGuest?.(link);
      return;
    }
    if (link && m.to === me) link.deliver(m);
  };
  return {
    code,
    kind: 'local',
    waitForGuest: () => pending,
    cancel: () => {
      if (cancelled) return;
      if (link) link.close();
      else closeAll();
      rejectGuest?.(new NetError('cancelled', 'Hosting cancelled.'));
    },
  };
}

/** Join a BroadcastChannel room; rejects with 'not-found' if no tab answers. */
export function joinLocal(code: string, opts: LocalLinkOpts = {}, timeoutMs = 1500): Promise<Transport> {
  if (typeof BroadcastChannel === 'undefined') return Promise.reject(new NetError('unsupported', 'This browser has no BroadcastChannel.'));
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(`snowplow-duel:${code}`);
    const me = randId();
    let link: LocalTransport | null = null;
    const t = setTimeout(() => {
      ch.close();
      reject(new NetError('not-found', `Room ${code} not found. Check the code (a room closes when its host leaves).`));
    }, timeoutMs);
    ch.onmessage = (e: MessageEvent<LocalMsg>) => {
      const m = e.data;
      if (!m || m.to !== me) return;
      if (!link) {
        if (m.k === 'full') {
          clearTimeout(t);
          ch.close();
          reject(new NetError('full', `Room ${code} already has two players.`));
        } else if (m.k === 'welcome') {
          clearTimeout(t);
          link = new LocalTransport(ch, me, m.from, opts, () => ch.close());
          resolve(link);
        }
        return;
      }
      link.deliver(m);
    };
    ch.postMessage({ k: 'hello', from: me } satisfies LocalMsg);
  });
}

/* ------------------------------------------------------------------ PeerJS (WebRTC) */

type PeerMod = typeof import('peerjs');
type PeerT = InstanceType<PeerMod['Peer']>;
type ConnT = ReturnType<PeerT['connect']>;

const ICE: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

let peerMod: Promise<PeerMod> | null = null;
function loadPeer(): Promise<PeerMod> {
  return (peerMod ??= import('peerjs'));
}

function toPayload(d: unknown): Payload | null {
  if (typeof d === 'string') return d;
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return null;
}

function peerErrorMessage(type: string, code: string): NetError {
  switch (type) {
    case 'peer-unavailable':
      return new NetError('not-found', `Room ${code} not found. Check the code (a room closes when its host leaves).`);
    case 'unavailable-id':
      return new NetError('unavailable', 'That room code is already in use.');
    case 'browser-incompatible':
      return new NetError('unsupported', "This browser doesn't support WebRTC data channels.");
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return new NetError('network', "Can't reach the PeerJS matchmaking server. Check your internet connection and try again.");
    default:
      return new NetError('unavailable', `Connection error (${type}).`);
  }
}

class PeerTransport implements Transport {
  readonly kind = 'peer' as const;
  onMessage: ((data: Payload) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private _open = true;

  constructor(
    private peer: PeerT,
    private rel: ConnT,
    private unrel: ConnT,
  ) {
    const onData = (d: unknown) => {
      const p = toPayload(d);
      if (p !== null && this._open) this.onMessage?.(p);
    };
    rel.on('data', onData);
    unrel.on('data', onData);
    const lost = (why: string) => {
      if (!this._open) return;
      this.shutdown();
      this.onClose?.(why);
    };
    rel.on('close', () => lost('closed'));
    unrel.on('close', () => lost('closed'));
    rel.on('error', () => lost('error'));
    rel.on('iceStateChanged', (s: RTCIceConnectionState) => {
      if (s === 'failed' || s === 'closed') lost('ice');
    });
  }

  get open(): boolean {
    return this._open;
  }

  send(data: Payload, reliable: boolean): void {
    if (!this._open) return;
    const dc = (reliable ? this.rel : this.unrel).dataChannel as RTCDataChannel | undefined;
    if (!dc || dc.readyState !== 'open') return;
    // Latest-wins traffic is dropped rather than queued behind a congested link.
    if (!reliable && dc.bufferedAmount > 64 * 1024) return;
    try {
      // RTCDataChannel.send copies synchronously, so callers can reuse their buffers.
      if (typeof data === 'string') dc.send(data);
      else dc.send(data);
    } catch {
      /* closing */
    }
  }

  close(): void {
    if (!this._open) return;
    this.shutdown();
  }

  private shutdown(): void {
    this._open = false;
    try {
      this.rel.close();
      this.unrel.close();
    } catch {
      /* already closed */
    }
    // Give the close message a moment to flush before the peer (and its server socket) goes.
    setTimeout(() => this.peer.destroy(), 300);
  }
}

/** Wait for both connections of a pair to open. */
function bothOpen(a: ConnT, b: ConnT, timeoutMs: number, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const t = setTimeout(
      () => reject(new NetError('timeout', `Found room ${code} but couldn't connect to the host (a firewall or NAT may be blocking peer-to-peer). Try another network.`)),
      timeoutMs,
    );
    const one = () => {
      if (++n === 2) {
        clearTimeout(t);
        resolve();
      }
    };
    for (const c of [a, b]) {
      if (c.open) one();
      else c.once('open', one);
    }
  });
}

export async function hostPeer(code: string | null): Promise<HostRoom> {
  const { Peer } = await loadPeer();
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = code && attempt === 0 ? code : makeRoomCode();
    const peer = new Peer(PEER_PREFIX + c, { config: ICE, debug: 1 });
    const ok = await new Promise<NetError | null>((resolve) => {
      const t = setTimeout(() => resolve(new NetError('network', "Timed out reaching the PeerJS matchmaking server. Check your connection and try again.")), 12000);
      peer.once('open', () => {
        clearTimeout(t);
        resolve(null);
      });
      peer.once('error', (e: { type: string }) => {
        clearTimeout(t);
        resolve(peerErrorMessage(e.type, c));
      });
    });
    if (ok) {
      peer.destroy();
      if (ok.code === 'unavailable' && attempt < 3) continue; // code taken: roll another
      throw ok;
    }
    return peerRoom(peer, c);
  }
  throw new NetError('unavailable', 'Could not find a free room code.');
}

function peerRoom(peer: PeerT, code: string): HostRoom {
  let resolveGuest: ((t: Transport) => void) | null = null;
  let rejectGuest: ((e: Error) => void) | null = null;
  let done = false;
  const pending = new Promise<Transport>((res, rej) => {
    resolveGuest = res;
    rejectGuest = rej;
  });
  pending.catch(() => {});
  const pairs = new Map<string, { rel?: ConnT; unrel?: ConnT }>();
  let guest: string | null = null;
  peer.on('connection', (conn: ConnT) => {
    if (done && conn.peer !== guest) {
      conn.on('open', () => {
        conn.send('{"t":"full"}');
        setTimeout(() => conn.close(), 200);
      });
      return;
    }
    const p = pairs.get(conn.peer) ?? {};
    if (conn.label === 'unrel') p.unrel = conn;
    else p.rel = conn;
    pairs.set(conn.peer, p);
    if (p.rel && p.unrel && !done) {
      const { rel, unrel } = p;
      done = true;
      guest = conn.peer;
      bothOpen(rel, unrel, 15000, code).then(
        () => resolveGuest?.(new PeerTransport(peer, rel, unrel)),
        (e) => {
          done = false;
          guest = null;
          pairs.delete(conn.peer);
          void e;
        },
      );
    }
  });
  // The signalling socket dropping does not break an established link; just try to stay registered.
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });
  return {
    code,
    kind: 'peer',
    waitForGuest: () => pending,
    cancel: () => {
      rejectGuest?.(new NetError('cancelled', 'Hosting cancelled.'));
      if (!guest) peer.destroy();
    },
  };
}

export async function joinPeer(code: string, timeoutMs = 20000): Promise<Transport> {
  const { Peer } = await loadPeer();
  const peer = new Peer({ config: ICE, debug: 1 });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new NetError('network', 'Timed out reaching the PeerJS matchmaking server. Check your connection and try again.')), 12000);
      peer.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      peer.once('error', (e: { type: string }) => {
        clearTimeout(t);
        reject(peerErrorMessage(e.type, code));
      });
    });
    const rel = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'raw', label: 'rel' });
    const unrel = peer.connect(PEER_PREFIX + code, { reliable: false, serialization: 'raw', label: 'unrel' });
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: { type: string }) => reject(peerErrorMessage(e.type, code));
      peer.once('error', onErr);
      // A full room answers on the reliable channel and hangs up.
      rel.once('data', (d: unknown) => {
        if (typeof d === 'string' && d.includes('"full"')) reject(new NetError('full', `Room ${code} already has two players.`));
      });
      bothOpen(rel, unrel, timeoutMs, code).then(() => {
        peer.off('error', onErr);
        resolve();
      }, reject);
    });
    return new PeerTransport(peer, rel, unrel);
  } catch (e) {
    peer.destroy();
    throw e;
  }
}

/** Host a room on the chosen transport. */
export function hostRoom(kind: TransportKind, code: string | null = null, opts: LocalLinkOpts = {}): Promise<HostRoom> {
  return kind === 'local' ? hostLocal(code, opts) : hostPeer(code);
}

export function joinRoom(kind: TransportKind, code: string, opts: LocalLinkOpts = {}): Promise<Transport> {
  return kind === 'local' ? joinLocal(code, opts) : joinPeer(code);
}
