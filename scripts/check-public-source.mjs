import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const excluded=new Set(['.git','node_modules','.sites-runtime','.wrangler','dist','.next','.vinext','coverage','outputs','work']);
const rules=[
 ['Site identity',/appgprj_[a-f0-9]{24,}/i],
 ['Site plugin identity',/plugin_asdk_app_sites_[a-f0-9]{24,}/i],
 ['Private deployment host',/(?:[a-z0-9-]+\.)+chatgpt\.site\b/i],
 ['Internal Git host',/git\.chatgpt-team\.site/i],
 ['GitHub access token',/(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{30,})/],
 ['Private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['OpenAI key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
];
const issues=[];let count=0;
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));
if('project_id'in manifest)issues.push('.openai/hosting.json: public template must not contain project_id');
async function walk(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(excluded.has(entry.name))continue;
  const file=path.join(directory,entry.name);
  const relative=path.relative('.',file).split(path.sep).join('/');
  if(entry.isSymbolicLink()){issues.push(relative+': symbolic link requires review');continue}
  if(entry.isDirectory()){await walk(file);continue}
  if(/^\.env(?:\.|$)|^\.dev\.vars|\.pem$|\.sqlite(?:3)?$|\.db$|\.tar(?:\.gz)?$/.test(entry.name)){issues.push(relative+': runtime/secret/archive file');continue}
  const bytes=await readFile(file);count++;
  if(bytes.includes(0))continue;
  const text=bytes.toString('utf8');
  for(const [name,pattern] of rules)if(pattern.test(text))issues.push(relative+': '+name);
 }
}
await walk('.');
if(issues.length){console.error(issues.join('\n'));process.exitCode=1}else console.log(`PASS: ${count} public source files; no deployment identity or credential patterns found`);
