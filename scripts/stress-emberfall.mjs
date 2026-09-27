/** Reproducible, bounded PixelForge workload. Findings are reported, not hidden. */
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {renderProject,inspectProject,patchRecipe,compareProjects,createBundle,createZip} from '../src/index.js';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'output','emberfall','stress');await mkdir(out,{recursive:true});
const report={date:new Date().toISOString(),node:process.version,platform:`${process.platform} ${process.arch}`,baseline:'092b457',assets:[],checks:[],findings:[]};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
for(const name of (await readdir(path.join(root,'demo','recipes'))).filter(n=>n.endsWith('.json'))){
 const recipe=JSON.parse(await readFile(path.join(root,'demo','recipes',name),'utf8')),start=performance.now(),a=await createBundle(recipe),ms=performance.now()-start,b=await createBundle(recipe);
 for(const [name,data] of a.files)assert.equal(hash(data),hash(b.files.get(name)),`${recipe.name}/${name} deterministic`);
 const atlas=JSON.parse(await readFile(path.join(root,'demo','assets',recipe.name,`${recipe.name}.atlas.json`),'utf8'));assert.equal(JSON.stringify(atlas),JSON.stringify(a.atlas.metadata));
 assert.equal(hash(a.files.get(`${recipe.name}.png`)),hash(await readFile(path.join(root,'demo','assets',recipe.name,`${recipe.name}.png`))));
 const view=inspectProject(a.project);assert.equal(view.cells.length,recipe.frames.length);
 const cli=spawnSync(process.execPath,['bin/pixelforge.js','validate',`demo/recipes/${name}`],{cwd:root,encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
 report.assets.push({name:recipe.name,frames:a.project.frames.length,animations:Object.keys(a.project.animations).length,operations:recipe.frames.reduce((n,f)=>n+(f.ops?.length||0)+(f.layers||[]).reduce((n,l)=>n+(l.ops?.length||0),0),0),exportMs:+ms.toFixed(2),files:a.files.size,bundleBytes:[...a.files.values()].reduce((n,b)=>n+b.length,0),warnings:a.project.warnings});
}
report.checks.push('All nine recipes validate via CLI; every bundle byte deterministic across two exports; checked-in atlases match recipes.');
const tiny={version:1,name:'probe',width:1,height:1,frames:[{name:'p',ops:[{op:'pixel',color:'#fff'}]}]};
const max={...tiny,name:'capacity',width:128,height:128,frames:Array.from({length:256},(_,i)=>({name:`p${i}`,duration:17+i%7,ops:[{op:'rect',w:128,h:128,color:i%2?'#234':'#567'}]}))};
let start=performance.now();const maxBundle=await createBundle(max);const maxView=inspectProject(maxBundle.project);
report.capacity={frames:256,sourcePixels:4194304,atlasPixels:maxBundle.atlas.width*maxBundle.atlas.height,contact:[maxView.sheet.width,maxView.sheet.height],exportAndInspectMs:+(performance.now()-start).toFixed(2)};
for(const [description,project,pattern] of [
 ['257 frames',{...tiny,frames:Array.from({length:257},(_,i)=>({name:`p${i}`}))},/256/],
 ['257px canvas',{...tiny,width:257},/256/],
 ['source area over limit',{...max,width:129},/4,194,304/],
 ['oversized atlas',{...max,sheet:{scale:3}},/16,777,216/],
 ['unknown field',{...tiny,typo:true},/unknown field/],
 ['null option',{...tiny,sheet:null},/null/],
 ['reserved output name',{...tiny,name:'CON'},/reserved/],
 ['case collision',{...tiny,frames:[{name:'Idle'},{name:'idle'}]},/duplicate/]
]){assert.throws(()=>renderProject(project),pattern);report.checks.push(`Rejected ${description} with diagnostic.`);}
const knight=JSON.parse(await readFile(path.join(root,'demo','recipes','knight.json'),'utf8'));
const edits=[{paint:'frames[idle-0]',value:[{x:0,y:0,color:'#ff00ff'}]}];
const patched=patchRecipe(knight,edits).recipe,comparison=compareProjects(renderProject(knight),renderProject(patched));
assert.deepEqual(comparison.frames.changed.map(f=>f.frame),['idle-0','hurt-0','hurt-1','hurt-2']);assert.equal(knight.frames[0].pixels,undefined);report.checks.push('Canvas patch changes base and three inherited frames, leaving source unchanged.');
const largeEdit=patchRecipe(max,[{set:'background',value:'#fff'},{set:'palette',value:{}}]);
// Recolor all 256 opaque frames; comparison must report all changes even if the image is sampled.
largeEdit.recipe.frames.forEach(f=>f.ops[0].color='#abc');const cmp=compareProjects(maxBundle.project,renderProject(largeEdit.recipe));assert.equal(cmp.frames.changed.length,256);assert.ok(cmp.image.omitted>0);report.checks.push(`256-frame comparison reports all frames and explicitly omits ${cmp.image.omitted} preview rows.`);
const mcpDir=await mkdtemp(path.join(out,'mcp-'));
function mcp(calls){const input=[{jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25'}},...calls.map(([name,args],i)=>({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name,arguments:args}}))].map(v=>JSON.stringify(v)).join('\n')+'\n';const r=spawnSync(process.execPath,['bin/pixelforge.js','mcp','--out',mcpDir],{cwd:root,input,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').slice(1).map(s=>JSON.parse(s).result);}
const [validated,painted]=mcp([['pixel_validate',{project:knight}],['pixel_patch',{project:knight,changes:edits}]]);assert.ok(!validated.isError&&!painted.isError);const revision=JSON.parse(painted.content[0].text).revision;
const [inspected,rendered]=mcp([['pixel_inspect',{revision,animation:'idle',grid:true,region:{x:19,y:10,w:16,h:14}}],['pixel_render',{revision}]]);assert.ok(!inspected.isError&&!rendered.isError);assert.equal(JSON.parse(rendered.content[0].text).preview.cells.length,33);report.checks.push('Real MCP validate → paint → restart → grid inspect → render retains revision and returns all 33 frames.');

// A valid 128px animation reaches the documented 1024-reference limit. Export fits
// the animation-pixel budget, but MCP render's mandatory preview refuses the request.
const long={...tiny,name:'long-preview',width:128,height:128,animations:{hold:{frames:Array(1024).fill('p')}}};
await createBundle(long);const [longResult]=mcp([['pixel_render',{project:long,animation:'hold'}]]);
if(longResult.isError)report.findings.push({id:'PF-EF-002',kind:'workflow limit',title:'Optional animation preview prevents an otherwise valid MCP export',error:JSON.parse(longResult.content[0].text).error,workaround:'Omit animation in pixel_render; inspect a shorter frames selection separately.'});

// ZIP32 has a 65,535-entry limit. This input is smaller than the studio's 2 MiB cap.
const zipRecipe={...tiny,name:'zip-limit',animations:Object.fromEntries(Array.from({length:65528},(_,i)=>[`a${i}`,{frames:['p']}]))};
start=performance.now();const zipBundle=await createBundle(zipRecipe);let zipError;
try{createZip(zipBundle.files);}catch(error){zipError=`${error.name}: ${error.message}`;}
if(zipError)report.findings.push({id:'PF-EF-001',kind:'bug',title:'Valid recipe overflows ZIP32 entry count after full export work',inputBytes:Buffer.byteLength(JSON.stringify(zipRecipe)),animationCount:65528,files:zipBundle.files.size,elapsedMs:+(performance.now()-start).toFixed(2),error:zipError});

// Symbol reference typing differs from the published JSON Schema.
const badStamp={...tiny,symbols:{dot:['x']},palette:{x:'#fff'},frames:[{name:'p',ops:[{op:'stamp',symbol:['dot']}]}]};
try{const p=renderProject(badStamp);if(p.frames[0].data[3]===255)report.findings.push({id:'PF-EF-003',kind:'bug',title:'Array-valued stamp symbol is accepted through property-key coercion',actual:'symbol: ["dot"] renders successfully',expected:'PixelError at project.frames[0].ops[0].symbol; schema requires a string.'});}catch{}
report.summary={recipes:report.assets.length,frames:report.assets.reduce((n,a)=>n+a.frames,0),animations:report.assets.reduce((n,a)=>n+a.animations,0),checks:report.checks.length,findings:report.findings.length,cpu:os.cpus()[0]?.model};
await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
