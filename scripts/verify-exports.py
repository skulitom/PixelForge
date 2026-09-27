"""Independent developer check. Requires Pillow, never used by PixelForge itself."""
from pathlib import Path
import base64
import io
import json
import subprocess
import zipfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / 'output' / 'forest-spirit'
atlas = json.loads((folder / 'forest-spirit.atlas.json').read_text())
sheet = Image.open(folder / atlas['meta']['image']).convert('RGBA')
assert sheet.size == (atlas['meta']['size']['w'], atlas['meta']['size']['h'])
for name, frame in atlas['frames'].items():
    rect = frame['frame']
    individual = Image.open(folder / 'frames' / f'{name}.png').convert('RGBA')
    cropped = sheet.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']))
    assert cropped.tobytes() == individual.tobytes(), name
for name, animation in atlas['animations'].items():
    image = Image.open(folder / 'animations' / f'{name}.png')
    assert image.n_frames == len(animation['frames']), name
    assert image.info['loop'] == (0 if animation['loop'] else 1)
    for index, frame_name in enumerate(animation['frames']):
        image.seek(index)
        assert image.info['duration'] == atlas['frames'][frame_name]['duration']
        expected = Image.open(folder / 'frames' / f'{frame_name}.png').convert('RGBA')
        assert image.convert('RGBA').tobytes() == expected.tobytes(), (name, index)

# Decode an independently generated transparent replacement frame to detect trails.
program = """
import { encodeAPNG } from './src/png.js';
process.stdout.write(encodeAPNG([
  {data:new Uint8Array([255,0,0,255,0,0,0,0]),duration:70},
  {data:new Uint8Array([0,0,0,0,0,255,0,128]),duration:130}
],2,1));
"""
image = Image.open(io.BytesIO(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root)))
image.seek(1)
assert list(image.convert('RGBA').getdata()) == [(0, 0, 0, 0), (0, 255, 0, 128)]

program = """
import { readFile } from 'node:fs/promises';
import { createBundle, createZip } from './src/export.js';
const spec = JSON.parse(await readFile('examples/forest-spirit.json', 'utf8'));
process.stdout.write(createZip((await createBundle(spec)).files));
"""
data = subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root)
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    assert archive.testzip() is None
    assert 'forest-spirit.atlas.json' in archive.namelist()
    Image.open(io.BytesIO(archive.read('forest-spirit.png'))).verify()
    count = len(archive.namelist())

# Decode an inspection contact sheet and compare every cell with the raw frame pixels.
program = """
import { readFile } from 'node:fs/promises';
import { renderProject, inspectProject } from './src/core.js';
import { encodePNG } from './src/png.js';
const project = renderProject(JSON.parse(await readFile('examples/forest-spirit.json', 'utf8')));
const { cells, sheet: { data, ...layout } } = inspectProject(project, { animation: 'idle', background: 'transparent' });
const frames = Object.fromEntries(project.frames.map(f => [f.name, Buffer.from(f.data).toString('base64')]));
process.stdout.write(JSON.stringify({ size: [project.width, project.height], cells, layout, frames, png: encodePNG(data, layout.width, layout.height).toString('base64') }));
"""
view = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root))
layout, size = view['layout'], tuple(view['size'])
contact = Image.open(io.BytesIO(base64.b64decode(view['png']))).convert('RGBA')
assert contact.size == (layout['width'], layout['height'])
cell_w, cell_h = size[0] * layout['scale'], size[1] * layout['scale']
for index, cell in enumerate(view['cells']):
    left = layout['gap'] + index % layout['columns'] * (cell_w + layout['gap'])
    top = layout['gap'] + index // layout['columns'] * (cell_h + layout['gap'])
    crop = contact.crop((left, top, left + cell_w, top + cell_h)).resize(size, Image.Resampling.NEAREST)
    assert crop.tobytes() == base64.b64decode(view['frames'][cell['frame']]), cell['frame']
print(f'Independent decode passed: sprite sheet, {len(atlas["frames"])} frames, {len(atlas["animations"])} APNGs, exact timing/alpha, {count}-file ZIP, and a {len(view["cells"])}-cell contact sheet.')
