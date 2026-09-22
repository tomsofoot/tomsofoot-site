/* Aucun paquet externe : assemblage déterministe, ordre des sources conservé. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => {const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
const root = path.resolve(arg('--output-root') || defaultRoot);
// --source-root sert seulement à tester un correctif isolé sur une copie existante.
const source = path.resolve(arg('--source-root') || root);
function file(name) {
  const destination = path.resolve(root,name);
  if (!destination.startsWith(root+path.sep)) throw Error('Chemin hors projet');
  return fs.existsSync(destination) ? destination : path.resolve(source,name);
}
const read = name => fs.readFileSync(file(name),'utf8');
const hash = content => createHash('sha256').update(content).digest('hex').slice(0,16);
const write = (name,content) => {const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);};
const localPath = url => decodeURI(new URL(url,'https://local.invalid').pathname).slice(1);
function css(url, parents=[]) {
  const name = localPath(url);
  if (parents.includes(name)) throw Error('Import CSS circulaire : '+name);
  let text = read(name).replace(/^\uFEFF/,'');
  // Les imports locaux sont développés à leur position, avant de résoudre les URL.
  text = text.replace(/@import\s+url\(['"]?([^)'"\s]+)['"]?\)\s*;/g, (_,value) => {
    const resolved = new URL(value,new URL(url,'https://local.invalid'));
    if (resolved.origin !== 'https://local.invalid') throw Error('Import distant non prévu : '+value);
    return css(resolved.pathname, [...parents,name]);
  });
  text = text.replace(/url\(\s*(?:(['"])(.*?)\1|([^)]*))\s*\)/gs, (all,quote,quoted,bare) => {
    const value=(quoted??bare).trim();
    if (/^(?:[a-z]+:|\/\/|\/|#)/i.test(value)) return all;
    const resolved=new URL(value,new URL(url,'https://local.invalid'));
    return `url("${resolved.pathname}${resolved.search}${resolved.hash}")`;
  });
  if (/@import\b/.test(text)) throw Error('Import CSS non résolu : '+name);
  return `\n/* Source : ${name} */\n${text}\n`;
}
const styles = JSON.parse(read('home/performance-assets.json')).styles;
const scripts = JSON.parse(read('home/scripts.json'));
const styleText = styles.map(url => css(url)).join('\n');
// Une seule tâche JavaScript réalise la composition. Aucun await entre les modules.
const appText = `(async()=>{\n'use strict';\ntry {\nawait window.TF_HOME.primary;\nif(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));\nwindow.TF_HOME.assembling=true;\n`
  + scripts.map(name => `\n;/* Source : home/${name} */\n${read('home/'+name)}\n;`).join('\n')
  + `\nwindow.TF_HOME.finish();\n}catch(error){console.error('TomsoFoot : initialisation interrompue',error);window.TF_HOME.fail();}\n})();\n`;
const loaderText=read('home/loader.js');
const assets={css:`home/dist/home.${hash(styleText)}.css`,app:`home/dist/home.${hash(appText)}.js`,loader:`home/dist/loader.${hash(loaderText)}.js`};
for (const [key,text] of [['css',styleText],['app',appText],['loader',loaderText]]) write(assets[key],text);
const tags = `\n<link rel="preload" as="script" href="/${assets.app}">\n<script src="/${assets.loader}"></script>\n<link rel="stylesheet" href="/${assets.css}">\n<script defer src="/${assets.app}" onerror="window.TF_HOME.fail()"></script>\n`;
const template=read('home/index.template.html');
if (!template.includes('<!-- HOME_PERFORMANCE_HEAD -->')) throw Error('Repère de compilation manquant');
write('index.html',template.replace('<!-- HOME_PERFORMANCE_HEAD -->',tags));
write('home/performance-build.json',JSON.stringify({assets,scripts: scripts.length,styles:styles.length,bytes:{js:Buffer.byteLength(appText)+Buffer.byteLength(loaderText),css:Buffer.byteLength(styleText)}},null,2)+'\n');
console.log(`Accueil : ${scripts.length} scripts regroupés en un bundle + un chargeur ; ${styles.length} feuilles CSS regroupées en une. index.html régénéré.`);
