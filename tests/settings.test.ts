import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'snowplow-showdown-settings-v1';

/** settings.ts reads localStorage once at import, so each case re-imports it fresh. */
async function loadWith(raw: string | null) {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === KEY ? raw : null), setItem: () => {} });
  return (await import('../src/core/settings')).settings;
}

afterEach(() => vi.unstubAllGlobals());

describe('settings', () => {
  it('defaults when nothing is stored', async () => {
    expect(await loadWith(null)).toEqual({ master: 1, music: 1, sfx: 1, shake: 1, quality: 'high', reduceFlash: false, keys: {} });
  });

  it('defaults on corrupted storage', async () => {
    expect((await loadWith('{oops')).quality).toBe('high');
  });

  it('clamps volumes, validates quality and drops unknown key bindings', async () => {
    const s = await loadWith(JSON.stringify({ master: 2, music: -1, sfx: 'loud', shake: 0.5, quality: 'ultra', keys: { notAnAction: 'KeyQ' } }));
    expect(s.master).toBe(1);
    expect(s.music).toBe(0);
    expect(s.sfx).toBe(1);
    expect(s.shake).toBe(0.5);
    expect(s.quality).toBe('high');
    expect(s.keys).toEqual({});
  });

  it('loads reduceFlash only when it is literally true', async () => {
    expect((await loadWith(JSON.stringify({ reduceFlash: true }))).reduceFlash).toBe(true);
    expect((await loadWith(JSON.stringify({ reduceFlash: 'yes' }))).reduceFlash).toBe(false);
  });

  it('keeps valid bindings and low quality', async () => {
    const { ACTIONS } = await import('../src/core/input');
    const a = ACTIONS[0].id;
    const s = await loadWith(JSON.stringify({ quality: 'low', keys: { [a]: 'KeyZ' } }));
    expect(s.quality).toBe('low');
    expect(s.keys).toEqual({ [a]: 'KeyZ' });
  });
});
