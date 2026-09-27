import { prepareScene, renderScene } from './scene.js';
import { reviewPixels } from './core.js';
const $ = id => document.getElementById(id);
let scene, time = 0, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, last, manualScale = false;
const paint = (canvas, data, width, height) => { if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0); };
function draw() {
  const view = renderScene(scene, { time, lit: $('lit').checked, density: $('density').checked });
  paint($('scene'), view.data, view.width, view.height); paint($('native'), view.data, view.width, view.height);
  paint($('values'), reviewPixels(view.data, 'grayscale'), view.width, view.height);
  $('scene').style.width = `${view.width * Number($('scale').value)}px`; $('scene').style.height = `${view.height * Number($('scale').value)}px`;
  $('time').value = time; $('clock').value = `${Math.round(time)} ms`; $('warnings').textContent = view.warnings.join(' ');
}
function playState() { $('play').textContent = playing ? 'Pause' : 'Play'; }
try {
  const response = await fetch('./scene.json'); if (!response.ok) throw new Error(`Scene could not load (${response.status})`);
  const source = await response.json(); scene = prepareScene(source);
  const fit = () => { if (!manualScale) $('scale').value = String(Math.min(3, Math.max(1, Math.floor((document.querySelector('.stage').clientWidth - 40) / scene.width)))); };
  fit(); addEventListener('resize', () => { fit(); draw(); });
  $('name').textContent = source.name.replaceAll('-', ' '); $('time').max = scene.duration - 1;
  $('play').onclick = () => { playing = !playing; last = undefined; playState(); };
  $('time').oninput = () => { time = Number($('time').value); playing = false; playState(); draw(); };
  for (const id of ['lit', 'density']) $(id).onchange = draw;
  $('scale').onchange = () => { manualScale = true; draw(); };
  if (scene.lighting?.lights.length) {
    // Every light is movable: pick one, then drag its position.
    $('lights').hidden = false;
    $('light-pick').replaceChildren(...scene.lighting.lights.map((_, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: String(i + 1) })));
    const selected = () => scene.lighting.lights[Number($('light-pick').value)];
    const sync = () => { for (const [i, id] of ['light-x', 'light-y'].entries()) $(id).value = selected().at[i]; };
    for (const [i, id] of ['light-x', 'light-y'].entries()) $(id).oninput = () => { selected().at[i] = Number($(id).value); draw(); };
    $('light-pick').onchange = sync; sync();
  }
  $('save').onclick = () => {
    const saved = structuredClone(source); scene.lighting.lights.forEach((light, i) => { saved.lighting.lights[i].at = [...light.at]; });
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${source.name}.scene.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.addEventListener('visibilitychange', () => { last = undefined; });
  playState(); draw();
  function tick(now) { if (playing && !document.hidden) { time = (time + (last === undefined ? 0 : now - last)) % scene.duration; draw(); } last = now; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
} catch (error) { $('error').textContent = error.message; }
