// A draw loop: ordinary Canvas 2D code, compiled to pixel art with `pixelforge compile examples/lantern.loop.mjs`.
// In a browser the same draw function paints a smooth version. Colours are CSS; the palette holds the same colours,
// so each maps to its key. What made the first version look wrong, and what this one does instead
// (docs/reports/code-first-animation.md#the-lantern-study):
//   - Light needs a surface. On a transparent canvas faint light became an opaque brown disc. Here it lands on a wall
//     and a floor, and their ramps are surfaces: light raises them along their own colours.
//   - Surface colours come from the light, not from taste: each step is what 'lighter' adds to the surface at that
//     step's level, so the bands match the smooth version. Eight small steps keep the first band from reading as a
//     disc.
//   - Small sprites smear when rotated. The lantern stays upright and its body trails the swing by whole pixels.
//   - The subject needs contrast: iron lighter than the wall, and frame edges lit by the flame.
//   - The light falls off eased, roughly (1 - r)^2: a linear falloff spread faint light over a wide ring, and its
//     first lit step drew a hard outer edge.
//   - Flicker pulses the radius; per-pixel noise only made ragged edges.
import { sinDeg, cosDeg } from '../src/craft.js';

const PERIOD = 1.6, SWING = 24, HOOK = [24, 1], ROPE = 12, FLOOR = 42, STEPS = 8;
// A surface lit by this light: step i is the base plus the light at the centre of band i (bands split the light above
// the ramp's default floor of 0.1 evenly), relative to the unlit band. The light's colour per unit of level is the
// orange key's colour over its level on the light ramp (0.6).
const lit = (base, light = [224, 134, 58].map(v => v / 0.6)) => Array.from({ length: STEPS }, (_, i) => {
  const added = 0.9 * i / STEPS;
  return '#' + base.map((v, k) => Math.min(255, Math.round(v + added * light[k])).toString(16).padStart(2, '0')).join('');
});
const WALL = 'aAbBcCeE'.split(''), GROUND = 'pPqQsStT'.split('');
const steps = (keys, colours) => Object.fromEntries(keys.map((key, i) => [key, colours[i]]));

export default {
  name: 'lantern', width: 48, height: 48,
  palette: {
    // Wall and floor, each from unlit to fully lit by the lantern.
    ...steps(WALL, lit([27, 26, 38])), ...steps(GROUND, lit([44, 40, 54])),
    // Iron, iron lit by the flame, rope, and the light itself from dim to bright.
    k: '#34304a', i: '#6a6388', x: '#c08a52', u: '#8c6c4c', d: '#4a2a26', r: '#9a4a2c', o: '#e0863a', y: '#f6c45e', w: '#fff3c4'
  },
  ramps: [
    { keys: ['d', 'r', 'o', 'y', 'w'], floor: 0.2, dither: 0.6 },
    { keys: WALL, surface: true, dither: 0.6 },
    { keys: GROUND, surface: true, dither: 0.6 }
  ],
  symbols: {
    handle: ['...iii...', '..i...i..', '..i...i..'],
    body: ['.kkkkkkk.', 'kiiiiiiik', '.xyyyyyx.', '.xyyoyyx.', '.xyowoyx.', '.xyowoyx.', '.xyyyyyx.', 'kiiiiiiik', '.kkkkkkk.', '...kkk...']
  },
  timeline: { length: 1600, rate: 10 },
  draw(ctx, t) {
    const angle = SWING * cosDeg(360 * t / PERIOD);
    const end = [HOOK[0] + 0.5 + ROPE * sinDeg(angle), HOOK[1] + ROPE * cosDeg(angle)];
    // The body trails the swing by the lean of a third of the rope's angle, measured at its middle, in whole pixels.
    const trail = Math.round(sinDeg(angle / 3) / cosDeg(angle / 3) * 8);
    const glass = [end[0] + trail, end[1] + 7.5];
    const flicker = 1 + 0.06 * sinDeg(360 * t * 3.3) + 0.04 * sinDeg(360 * t * 7.1);

    ctx.fillStyle = '#1b1a26'; ctx.fillRect(0, 0, 48, FLOOR);
    ctx.fillStyle = '#2c2836'; ctx.fillRect(0, FLOOR, 48, 48 - FLOOR);

    ctx.globalCompositeOperation = 'lighter';
    // Light on the floor: a circular gradient squashed by scale() into an ellipse under the lantern.
    ctx.save();
    ctx.translate(glass[0], 44); ctx.scale(1, 0.25);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
    pool.addColorStop(0, 'rgba(224, 134, 58, 0.6)');
    pool.addColorStop(1, 'rgba(224, 134, 58, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Light on the wall, brightest at the glass and falling off eased.
    const radius = 22 * flicker, halo = ctx.createRadialGradient(glass[0], glass[1], 0, glass[0], glass[1], radius);
    halo.addColorStop(0, 'rgba(246, 196, 94, 0.85)');
    halo.addColorStop(0.25, 'rgba(224, 134, 58, 0.5)');
    halo.addColorStop(0.5, 'rgba(224, 134, 58, 0.22)');
    halo.addColorStop(0.75, 'rgba(224, 134, 58, 0.06)');
    halo.addColorStop(1, 'rgba(224, 134, 58, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(glass[0] - radius - 1, glass[1] - radius - 1, 2 * radius + 2, 2 * radius + 2);
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(HOOK[0], HOOK[1]); ctx.rotate(-angle * Math.PI / 180);
    ctx.strokeStyle = '#8c6c4c'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.lineTo(0.5, ROPE - 0.5); ctx.stroke();
    ctx.restore();
    ctx.drawImage('handle', end[0] - 4.5, end[1]);
    ctx.drawImage('body', end[0] - 4.5 + trail, end[1] + 3);
    ctx.point('light', glass[0], glass[1]);
  }
};
