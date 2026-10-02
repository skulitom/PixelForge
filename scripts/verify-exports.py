"""Independent developer check. Requires Pillow, never used by PixelForge itself."""
from pathlib import Path
import base64
import io
import json
import subprocess
import tempfile
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

# Decode a patch comparison: each row's before and after cells must show their frames' opaque pixels.
program = """
import { readFile } from 'node:fs/promises';
import { renderProject, compareProjects } from './src/core.js';
import { patchRecipe } from './src/patch.js';
import { encodePNG } from './src/png.js';
const recipe = JSON.parse(await readFile('examples/forest-spirit.json', 'utf8'));
const before = renderProject(recipe), after = renderProject(patchRecipe(recipe, [{ set: 'palette.k', value: '#5a2d3c' }]).recipe);
const { image: { region, frames, sheet: { data, ...layout } } } = compareProjects(before, after);
const raw = project => Object.fromEntries(project.frames.map(f => [f.name, Buffer.from(f.data).toString('base64')]));
process.stdout.write(JSON.stringify({ width: after.width, region, frames, layout, before: raw(before), after: raw(after), png: encodePNG(data, layout.width, layout.height).toString('base64') }));
"""
diff = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root))
layout, region = diff['layout'], diff['region']
comparison = Image.open(io.BytesIO(base64.b64decode(diff['png']))).convert('RGBA')
assert comparison.size == (layout['width'], layout['height']) and layout['columns'] == 2
cell_w, cell_h = region['w'] * layout['scale'], region['h'] * layout['scale']
for row, entry in enumerate(diff['frames']):
    for column, side in enumerate(('before', 'after')):
        left, top = layout['gap'] + column * (cell_w + layout['gap']), layout['gap'] + row * (cell_h + layout['gap'])
        cell = comparison.crop((left, top, left + cell_w, top + cell_h)).resize((region['w'], region['h']), Image.Resampling.NEAREST)
        raw = base64.b64decode(diff[side][entry['frame']])
        for y in range(region['h']):
            for x in range(region['w']):
                at = ((region['y'] + y) * diff['width'] + region['x'] + x) * 4
                if raw[at + 3] == 255:
                    assert cell.getpixel((x, y)) == tuple(raw[at:at + 4]), (entry['frame'], side, x, y)

# Exercise actual MCP responses and decode canvas corrections after a real server restart.
with tempfile.TemporaryDirectory(prefix='pixelforge-decode-') as temporary:
    assert Path(temporary).resolve().is_relative_to(Path(tempfile.gettempdir()).resolve())
    recipe = {
        'version': 1, 'name': 'painted', 'width': 3, 'height': 2,
        'frames': [
            {'name': 'a', 'duration': 70, 'layers': [{'x': 1, 'y': 1, 'ops': [{'op': 'pixel', 'color': '#f00'}]}]},
            {'name': 'b', 'duration': 130, 'from': 'a'}
        ]
    }

    def mcp(name, arguments):
        messages = [
            {'jsonrpc': '2.0', 'id': 0, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
        ]
        response = subprocess.check_output(['node', 'bin/pixelforge.js', 'mcp', '--out', temporary],
                                           input=''.join(json.dumps(m) + '\n' for m in messages).encode(), cwd=root)
        result = json.loads(response.splitlines()[-1])['result']
        assert not result.get('isError'), result
        return result

    patched = mcp('pixel_patch', {'project': recipe, 'changes': [{'paint': 'frames[a]', 'value': [
        {'x': 1, 'y': 1, 'color': 'transparent'}, {'x': 2, 'y': 0, 'color': '#00ff0080'}
    ]}]})
    revision = json.loads(patched['content'][0]['text'])['revision']
    result = mcp('pixel_render', {'revision': revision})
    info = json.loads(result['content'][0]['text'])
    preview = info['preview']
    assert preview['cells'] == [{'frame': 'a', 'duration': 70}, {'frame': 'b', 'duration': 130}]
    image = Image.open(io.BytesIO(base64.b64decode(result['content'][1]['data']))).convert('RGBA')
    layout = preview['sheet']
    assert image.size == (layout['width'], layout['height'])
    for index, entry in enumerate(preview['cells']):
        raw = Image.open(Path(info['directory']) / 'frames' / (entry['frame'] + '.png')).convert('RGBA')
        assert raw.getpixel((1, 1)) == (0, 0, 0, 0)
        assert raw.getpixel((2, 0)) == (0, 255, 0, 128)
        left = layout['gap'] + index % layout['columns'] * (3 * layout['scale'] + layout['gap'])
        top = layout['gap'] + index // layout['columns'] * (2 * layout['scale'] + layout['gap'])
        cell = image.crop((left, top, left + 3 * layout['scale'], top + 2 * layout['scale'])).resize((3, 2), Image.Resampling.NEAREST)
        assert cell.getpixel((1, 1)) == (143, 145, 151, 255)
        assert cell.getpixel((2, 0)) == (65, 194, 69, 255)
    with Image.open(Path(info['directory']) / 'animations' / 'default.png') as animated:
        assert animated.n_frames == 2
        for index, duration in enumerate((70, 130)):
            animated.seek(index)
            assert animated.info['duration'] == duration
            assert animated.convert('RGBA').getpixel((1, 1)) == (0, 0, 0, 0)
            assert animated.convert('RGBA').getpixel((2, 0)) == (0, 255, 0, 128)

# Decode GIFs with Pillow and compare every pixel, delay and loop flag with the rendered frames: once with
# 1-bit transparency (alpha below 128 is clear) and once blended onto a background and scaled.
program = """
import { readFile } from 'node:fs/promises';
import { renderProject } from './src/core.js';
import { animationGIF } from './src/gif.js';
const project = renderProject(JSON.parse(await readFile('examples/forest-spirit.json', 'utf8'))), out = {};
for (const [name, options] of [['idle', { scale: 1 }], ['blink', { scale: 3, background: '#17191d' }]]) {
  const gif = animationGIF(project, name, options);
  out[name] = { data: Buffer.from(gif.data).toString('base64'), loop: gif.loop, scale: gif.scale, width: project.width, height: project.height,
    frames: project.animations[name].frames.map(i => ({ rgba: Buffer.from(project.frames[i].data).toString('base64'), duration: project.frames[i].duration })) };
}
process.stdout.write(JSON.stringify(out));
"""
gifs = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root))
matte = (0x17, 0x19, 0x1d)
for name, expected in gifs.items():
    image = Image.open(io.BytesIO(base64.b64decode(expected['data'])))
    scale, width, height = expected['scale'], expected['width'], expected['height']
    assert image.format == 'GIF' and image.size == (width * scale, height * scale), name
    assert image.n_frames == len(expected['frames']), name
    assert image.info.get('loop') == (0 if expected['loop'] else None), (name, image.info.get('loop'))
    for index, frame in enumerate(expected['frames']):
        image.seek(index)
        assert image.info['duration'] == frame['duration'], (name, index)
        source = base64.b64decode(frame['rgba'])
        decoded = image.convert('RGBA').resize((width, height), Image.Resampling.NEAREST)
        for position, actual in enumerate(decoded.getdata()):
            r, g, b, a = source[position * 4:position * 4 + 4]
            if name == 'blink':
                wanted = tuple((channel * a + back * (255 - a) + 127) // 255 for channel, back in zip((r, g, b), matte)) + (255,)
            else:
                wanted = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
            assert actual == wanted, (name, index, position, actual, wanted)
        # Every pixel of a scaled block is the same colour: nothing was resampled.
        assert image.convert('RGBA').tobytes() == decoded.resize(image.size, Image.Resampling.NEAREST).tobytes(), (name, index)

print(f'Independent decode passed: {len(gifs)} GIFs with exact pixels, delays and loop flags, sprite sheet, {len(atlas["frames"])} frames, {len(atlas["animations"])} APNGs, exact timing/alpha, {count}-file ZIP, a {len(view["cells"])}-cell contact sheet, a {len(diff["frames"])}-row patch comparison, and MCP painting/restart/all-frame preview.')
