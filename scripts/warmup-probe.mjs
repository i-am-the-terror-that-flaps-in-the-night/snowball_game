// Shader warm-up probe: node scripts/warmup-probe.mjs [--only=on|off] [--scenarios=a,b]
// Loads the game in headless Chromium twice (warm-up on, and ?nowarm = warm-up and load-time warm set off) and, in a
// fresh page per scenario, counts renderer.info.programs.length before / after each "first" event: arena build,
// round start, first kill, first Inferno, first ARSENAL ultimate (SINGULARITY), THE DONALD's props, a Brawl rival
// wreck and a quality LOW -> HIGH / bloom toggle. Success with the warm-up on: no program-count jump at the events
// (the compiles happen at the arena build / menu instead).
//
// Frames are driven by hand (the animation loop is stopped): tick(1/60) + post.ts renderFrame (the game's render path,
// bloom included). After each arena build the probe waits for the warm-up's compileAsync to finish, as the game's
// render gate would. Programs are only created when something is drawn or compiled, so ticks without a render are
// free; every event is followed by rendered frames.
//
// Env: PW_EXE -> a Chromium binary (e.g. /opt/pw-browsers/chromium in cloud containers; otherwise installed Chrome),
// PROBE_GPU=0 -> SwiftShader (needed without a GPU), PORT -> Vite port. SwiftShader at 1280x720 takes a few minutes.
import { createServer } from 'vite';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const variants = opt('only', '') ? [opt('only')] : ['on', 'off'];
const ALL = ['campaign', 'arsenal', 'donald', 'brawl', 'quality'];
const scenarios = opt('scenarios', '') ? opt('scenarios').split(',') : ALL;

const port = Number(process.env.PORT) || 6500 + Math.floor(Math.random() * 100);
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const gpu = process.env.PROBE_GPU !== '0';
const browser = await chromium.launch({
  ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : { channel: 'chrome' }),
  headless: true,
  args: [gpu ? '--use-angle=metal' : '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Page-side helpers (installed after load). */
async function install(page) {
  await page.evaluate(async () => {
    const g = window.__game;
    g.setLoop(false);
    const post = await import('/src/render/post.ts');
    const bosses = await import('/src/entities/enemies/bosses.ts');
    const settingsMod = await import('/src/core/settings.ts');
    const c = () => g.ctx;
    const inp = () => c().input;
    const log = [];
    const H = {
      log,
      progs: () => g.renderer.info.programs.length,
      render: () => post.renderFrame(g.renderer, c().scene, c().camera),
      frames(n, each) {
        for (let i = 0; i < n; i++) {
          if (each) each(i);
          g.tick(1 / 60);
          H.render();
        }
      },
      ticks(n, each) {
        for (let i = 0; i < n; i++) {
          if (each) each(i);
          g.tick(1 / 60);
        }
      },
      async settle() {
        for (let i = 0; i < 500 && g.warmup.busy; i++) await new Promise((r) => setTimeout(r, 20));
      },
      /** Run `fn` (may be async) and record the program count around it (plus `after` rendered frames). */
      async step(name, fn, after = 3) {
        const before = H.progs();
        const had = new Set(g.renderer.info.programs);
        const t0 = performance.now();
        await fn();
        H.frames(after);
        // New programs by name (the material type or name; MeshDepthMaterial / MeshDistanceMaterial = shadow pass).
        const added = g.renderer.info.programs.filter((p) => !had.has(p)).map((p) => p.name || p.cacheKey.split(',').slice(0, 2).join(',').slice(0, 40));
        log.push({ name, before, after: H.progs(), added, ms: Math.round(performance.now() - t0) });
      },
      press(code) {
        inp().down.add(code);
        inp().pressed.add(code);
      },
      release(code) {
        inp().down.delete(code);
      },
      loadout(plow) {
        const pr = c().progression;
        pr.setPlow(plow);
        pr.commit();
      },
      countdown() {
        H.ticks(Math.ceil(g.countdown * 60) + 2);
      },
      nearest() {
        const p = c().plow.position;
        let best = null, bd = 1e9;
        for (const e of c().enemies.query(p.x, p.z, 1e4)) {
          if (!e.alive) continue;
          const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
          if (d < bd) (bd = d), (best = e);
        }
        return best;
      },
      /** Put the nearest bot right in front of the plow. */
      ahead(e, fwd) {
        const p = c().plow, h = p.heading;
        e.position.x = p.position.x + Math.sin(h) * fwd;
        e.position.z = p.position.z + Math.cos(h) * fwd;
      },
      bosses,
      settings: settingsMod,
    };
    window.__w = H;
  });
}

const SCENARIOS = {
  /** Classic Plow in Coldboot Glacier: arena build, round start, first kill, first Inferno. */
  campaign: async (ev) => {
    await ev(async () => {
      const H = window.__w, g = window.__game;
      H.loadout('classic');
      await H.step('menu (first frames)', () => {}, 3);
      await H.step('arena build (startRun) + warm-up', async () => {
        g.startRun(0);
        await H.settle();
      }, 0);
      await H.step('first arena frames', () => {}, 3);
      await H.step('round start (bots spawn)', () => H.countdown(), 3);
      g.impact.enabled = false;
      await H.step('first kill (wreck + debris)', () => {
        const e = H.nearest();
        H.ahead(e, 8);
        H.frames(2);
        g.ctx.enemies.damage(e, 1e9);
      }, 20);
      await H.step('first Inferno (F)', () => {
        const e = H.nearest();
        if (e) H.ahead(e, 5);
        H.press('KeyF');
      }, 30);
      H.release('KeyF');
      return { flameReady: g.ctx.combat.flameReady };
    });
  },
  /** ARSENAL: first SINGULARITY (open, lensing grab, collapse). */
  arsenal: async (ev) => {
    await ev(async () => {
      const H = window.__w, g = window.__game;
      H.loadout('arsenal');
      await H.step('arena build (startRun) + warm-up', async () => {
        g.startRun(0);
        await H.settle();
      }, 0);
      await H.step('first arena frames', () => {}, 3);
      await H.step('round start (bots spawn)', () => H.countdown(), 3);
      g.impact.enabled = false;
      await H.step('first ARSENAL ultimate (SINGULARITY)', () => {
        g.ctx.combat.armForReplay(true);
        H.ticks(1);
        H.press('KeyF');
      }, 40);
      H.release('KeyF');
      await H.step('SINGULARITY collapse / explosion', () => {}, 120);
      return { plow: g.ctx.stats.plowKind };
    });
  },
  /** Golden Tower Plaza boss round: THE DONALD's walls, deportation beam and rally podium. */
  donald: async (ev) => {
    await ev(async () => {
      const H = window.__w, g = window.__game;
      H.loadout('classic');
      await H.step('arena build (startRun plaza) + warm-up', async () => {
        g.startRun(4);
        g.roundIndex = g.ctx.zone.rounds.length - 1;
        g.beginCountdown();
        await H.settle();
      }, 0);
      await H.step('first arena frames', () => {}, 3);
      await H.step('boss round start (THE DONALD spawns)', () => H.countdown(), 3);
      g.impact.enabled = false;
      g.ctx.stats.maxHp = 1e6;
      g.ctx.plow.applyStats(g.ctx.stats);
      g.ctx.plow.hp = 1e6;
      const force = (kind) => {
        const b = g.ctx.enemies.bosses[0];
        if (!b) return;
        if (!H.bosses.donaldTimers(b)) g.tick(1 / 60);
        const t = H.bosses.donaldTimers(b);
        if (!t) return;
        t.wallCd = kind === 'wall' ? 0 : 99;
        t.beamCd = kind === 'beam' ? 0 : 99;
        t.rallyCd = kind === 'rally' ? 0 : 99;
        t.rallied = kind !== 'rally';
        b.stun = 0;
        b.cd = 0;
      };
      await H.step('BUILD THE WALL', () => {
        force('wall');
        H.ticks(240);
      }, 10);
      await H.step('DEPORTATION beam', () => {
        force('beam');
        H.ticks(30);
        H.frames(10);
        H.ticks(90);
      }, 10);
      await H.step('RALLY podium', () => {
        force('rally');
        H.ticks(240);
      }, 10);
      return { boss: g.ctx.enemies.bosses[0]?.type ?? null };
    });
  },
  /** Brawl: first rival wreck (debris batches in the rival's paint). */
  brawl: async (ev) => {
    await ev(async () => {
      const H = window.__w, g = window.__game;
      H.loadout('classic');
      await H.step('arena build (startBrawl) + warm-up', async () => {
        g.startBrawl('pro');
        await H.settle();
      }, 0);
      await H.step('first arena frames', () => {}, 3);
      await H.step('brawl start', () => H.countdown(), 3);
      g.impact.enabled = false;
      await H.step('first rival wreck', () => {
        const e = H.nearest();
        H.ahead(e, 9);
        H.frames(2);
        g.ctx.enemies.damage(e, 1e9);
      }, 20);
      return {};
    });
  },
  /** Settings: LOW -> HIGH (shadows back) and Bloom off -> on, in an arena. */
  quality: async (ev) => {
    await ev(async () => {
      const H = window.__w, g = window.__game, S = H.settings;
      await H.step('arena build (startRun) + warm-up', async () => {
        g.startRun(0);
        await H.settle();
      }, 0);
      await H.step('first arena frames', () => {}, 3);
      await H.step('quality HIGH -> LOW (change + warm-up)', async () => {
        S.settings.quality = 'low';
        S.applyQuality(g.ctx);
        await H.settle();
      }, 0);
      await H.step('  frames after quality HIGH -> LOW', () => {}, 3);
      await H.step('quality LOW -> HIGH (change + warm-up)', async () => {
        S.settings.quality = 'high';
        S.applyQuality(g.ctx);
        await H.settle();
      }, 0);
      await H.step('  frames after quality LOW -> HIGH', () => {}, 3);
      await H.step('bloom off (change + warm-up)', async () => {
        S.settings.bloom = false;
        S.applyQuality(g.ctx);
        await H.settle();
      }, 0);
      await H.step('  frames after bloom off', () => {}, 3);
      await H.step('bloom on (new bloom chain) (change + warm-up)', async () => {
        S.settings.bloom = true;
        S.applyQuality(g.ctx);
        await H.settle();
      }, 0);
      await H.step('  frames after bloom on', () => {}, 3);
      return {};
    });
  },
};

const results = {};
const errors = [];
for (const v of variants) {
  results[v] = {};
  for (const s of scenarios) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`[${v}/${s}] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[${v}/${s}] ${m.text()}`);
      else if (m.type() === 'warning' && m.text().includes('warmup')) errors.push(`[${v}/${s}] ${m.text()}`);
    });
    try {
      await page.goto(`http://localhost:${port}/?debug${v === 'off' ? '&nowarm' : ''}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game, null, { polling: 100, timeout: 60000 });
      // Let the menu's idle warm-up run (warm-up on) as it would before the player clicks anything.
      await page.waitForTimeout(1500);
      await page.evaluate(async () => {
        for (let i = 0; i < 500 && window.__game.warmup.busy; i++) await new Promise((r) => setTimeout(r, 20));
      });
      await install(page);
      let extra = null;
      await SCENARIOS[s](async (fn) => (extra = await page.evaluate(fn)));
      results[v][s] = { steps: await page.evaluate(() => window.__w.log), extra };
    } catch (e) {
      errors.push(`[${v}/${s}] probe: ${e.message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
}
await browser.close();
await server.close();

const pad = (x, n) => String(x).padEnd(n);
const lpad = (x, n) => String(x).padStart(n);
for (const s of scenarios) {
  console.log(`\n== ${s}`);
  console.log(`${pad('event', 44)}${variants.map((v) => `${lpad(`warm ${v}: before->after (+d)`, 30)}`).join('')}`);
  const names = results[variants[0]][s]?.steps.map((x) => x.name) ?? [];
  for (const n of names) {
    const cols = variants.map((v) => {
      const st = results[v][s]?.steps.find((x) => x.name === n);
      return lpad(st ? `${st.before}->${st.after} (+${st.after - st.before})` : '-', 30);
    });
    console.log(`${pad(n, 44)}${cols.join('')}`);
    for (const v of variants) {
      const st = results[v][s]?.steps.find((x) => x.name === n);
      if (st?.added?.length && (st.added.length <= 12 || process.env.ALL_NEW)) console.log(`${pad('', 6)}${v} new: ${st.added.join(', ')}`);
    }
  }
  for (const v of variants) if (results[v][s]?.extra && Object.keys(results[v][s].extra).length) console.log(`  ${v}: ${JSON.stringify(results[v][s].extra)}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
}
console.log(`\nJSON ${JSON.stringify(results)}`);
process.exit(errors.length ? 1 : 0);
