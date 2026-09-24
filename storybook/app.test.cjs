// State-machine tests with simulated browser/media APIs. No physical microphone is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const elements = [];
class Element {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.dataset={}; this.attributes={}; this.events={}; this.value=''; this.textContent=''; this.hidden=false; this.disabled=false; this.className=''; this.classList={toggle:(key,on)=>{const s=new Set(this.className.split(' '));on?s.add(key):s.delete(key);this.className=[...s].join(' ');},add:key=>{this.className+=' '+key;}}; elements.push(this); }
  append(...children) { this.children.push(...children); children.filter(x=>x instanceof Element).forEach(x=>x.parentElement=this); }
  replaceChildren(...children) { this.children=[];this.append(...children); }
  setAttribute(k,v) { this.attributes[k]=v; }
  removeAttribute(k) { delete this.attributes[k]; if(k==='src') this.src=''; }
  addEventListener(k,v) { this.events[k]=v; }
  querySelector(selector) { return this.children.find(x=>x instanceof Element && (selector.startsWith('.') ? x.className.split(' ').includes(selector.slice(1)) : selector==='[aria-current="true"]' && x.attributes['aria-current']==='true')) || null; }
  add(option) { this.append(option); }
  focus() {} scrollIntoView() {} remove() {} load() {} pause() { this.paused=true; }
  play() { this.paused=false; return Promise.resolve(); }
  showModal() { this.open=true; } close() { this.open=false; }
  click() { if(!this.disabled) return this.onclick?.({target:this}); }
}
const shell = fs.readFileSync(path.join(__dirname,'shell.html'),'utf8');
const ids = Object.fromEntries([...shell.matchAll(/\bid="([^"]+)"/g)].map(m=>{const e=new Element();e.id=m[1];return[m[1],e];}));
const tabs = new Element(); ['edit','record','play'].forEach(key=>{ids['tab-'+key].dataset.tab=key;tabs.append(ids['tab-'+key]);});
for(const id of ['tts-button','record-button','preview-button']) { const a=new Element();a.className='action-label';const b=new Element();b.className='action-icon';ids[id].append(a,b); }
const saveButton=new Element('button');saveButton.dataset.action='save';
const openButton=new Element('button');openButton.dataset.action='open';
const prevButton=new Element('button');prevButton.dataset.prev='';
const nextButton=new Element('button');nextButton.dataset.next='';
function matches(e,selector) {
  if(selector==='[data-tab]')return 'tab' in e.dataset;
  if(selector==='[data-action]')return 'action' in e.dataset;
  if(selector==='[data-action="save"]')return e.dataset.action==='save';
  if(selector==='[data-action="open"]')return e.dataset.action==='open';
  if(selector==='[data-prev]')return 'prev' in e.dataset;
  if(selector==='[data-next]')return 'next' in e.dataset;
  if(selector==='[data-art]')return 'art' in e.dataset;
  if(selector==='.page-thumb')return e.className==='page-thumb';
  if(selector==='.page-dots button')return e.parentElement?.id?.endsWith('-dots');
  if(selector==='#friend-choices button')return e.parentElement?.id==='friend-choices';
  return false;
}
const document = {getElementById:id=>ids[id],createElement:tag=>new Element(tag),createTextNode:text=>text,querySelectorAll:query=>elements.filter(e=>query.split(',').some(s=>matches(e,s))),body:new Element(),events:{},addEventListener(k,v){this.events[k]=v;}};
let now=0, timer=0, savedBlob, getMedia, lastRecorder;
const timers=new Map(), streams=[], speech=[];
function stream() { const track={stopped:false,stop(){this.stopped=true;}};const s={track,getTracks:()=>[track],getAudioTracks:()=>[track]};streams.push(s);return s; }
class Recorder {
  static isTypeSupported(type) { return type==='audio/webm;codecs=opus'; }
  constructor(s,options) { this.state='inactive';this.mimeType=options.mimeType;lastRecorder=this; }
  start() { this.state='recording'; }
  stop() { this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['x'.repeat(500)],{type:this.mimeType})});this.onstop?.();}); }
}
class Reader { async readAsDataURL(blob) { try {this.result='data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload?.();}catch(error){this.error=error;this.onerror?.();} } }
const context=vm.createContext({document,console,Blob,FileReader:Reader,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Option:class extends Element {constructor(label,value){super('option');this.textContent=label;this.value=value;}},SpeechSynthesisUtterance:class {constructor(text){this.text=text;}},MediaRecorder:Recorder,performance:{now:()=>now},crypto:require('node:crypto').webcrypto,matchMedia:()=>({matches:true}),indexedDB:{open(){throw new Error('No storage in this test');}},navigator:{mediaDevices:{getUserMedia:()=>getMedia()}},setTimeout:(f)=>{timers.set(++timer,f);return timer;},clearTimeout:id=>timers.delete(id),setInterval:(f)=>{timers.set(++timer,f);return timer;},clearInterval:id=>timers.delete(id)});
context.window=context;context.isSecureContext=true;context.events={};context.addEventListener=(k,v)=>{context.events[k]=v;};
context.speechSynthesis={getVoices:()=>[],addEventListener(){},cancel(){},speak:s=>{speech.push(s);s.onstart?.();}};
context.showSaveFilePicker=async()=>({createWritable:async()=>({write:async blob=>{savedBlob=blob;},close:async()=>{}})});
context.ART={rabbit:'data:image/png;base64,aW1hZ2U=',bear:'data:image/png;base64,aW1hZ2U=',cat:'data:image/png;base64,aW1hZ2U=',penguin:'data:image/png;base64,aW1hZ2U='};
ids.rate.value='0.9';
vm.runInContext(fs.readFileSync(path.join(__dirname,'core.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),context);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const click=id=>ids[id].click();
async function snapshot(){await saveButton.click();return JSON.parse(await savedBlob.text());}
(async()=>{
  await settle();
  assert.equal(ids['page-total'].textContent,'3장');
  await click('tab-record');
  let allow;
  getMedia=()=>new Promise(resolve=>{allow=resolve;});
  const pending=click('record-button');
  assert.equal(ids['record-button'].querySelector('.action-label').textContent,'취소하기');
  assert.equal(nextButton.disabled,true);
  await click('record-button');
  const canceledStream=stream();allow(canceledStream);await pending;
  assert.equal(canceledStream.track.stopped,true,'late permission result must release microphone');
  assert.equal(nextButton.disabled,false);

  getMedia=async()=>stream();
  await click('tts-button');const oldSpeech=speech[0];
  await click('record-button');
  assert.equal(ids['tab-edit'].disabled,true,'navigation locks during recording');
  assert.equal(saveButton.disabled,true,'saving cannot omit an unfinished recording');
  oldSpeech.onend();assert.equal(speech.length,1,'canceled TTS cannot restart after recording starts');
  now+=1300;await click('record-button');await settle();await settle();
  assert.equal(streams.at(-1).track.stopped,true);
  assert.equal(ids['preview-button'].disabled,false);
  const first=await snapshot();assert(first.pages[0].audio);assert.equal(first.pages[1].audio,null);
  assert.equal(first.pages[0].audio.duration,1.3);

  await click('record-button');now+=1600;await click('record-button');await settle();await settle();
  const second=await snapshot();assert.equal(second.pages[0].previousAudio.duration,1.3);assert.equal(second.pages[0].audio.duration,1.6);
  await click('undo-recording');const undone=await snapshot();assert.equal(undone.pages[0].audio.duration,1.3);

  await click('record-button');now+=900;lastRecorder.onerror();await settle();await settle();
  const afterFailure=await snapshot();assert.equal(afterFailure.pages[0].audio.duration,1.3,'failed rerecord keeps prior audio');
  assert.equal(ids['tab-edit'].disabled,false);

  getMedia=async()=>{const e=new Error('denied');e.name='NotAllowedError';throw e;};
  const denied=click('record-button');await settle();
  assert.equal(ids.dialog.open,true);
  await ids['dialog-actions'].children[0].click();await denied;
  assert.equal(ids['record-button'].disabled,false);

  await click('tab-play');const missingPromise=click('play-button');await settle();
  assert.equal(ids['dialog-content'].children[0].textContent,'아직 목소리를 기다려요 🎙️');
  await ids['dialog-actions'].children[1].click();await missingPromise;
  assert.equal(ids['tab-record'].attributes['aria-selected'],'true');
  assert.equal(ids['record-page'].textContent,'2 / 3');

  // Cancel a long-awaited microphone prompt by hiding the page.
  getMedia=()=>new Promise(resolve=>{allow=resolve;});
  const backgroundPending=click('record-button');document.hidden=true;document.events.visibilitychange();
  const backgroundStream=stream();allow(backgroundStream);await backgroundPending;document.hidden=false;
  assert.equal(backgroundStream.track.stopped,true);
  assert.equal(ids['record-button'].disabled,false);
  console.log('PASS: canceled/denied microphone, recording navigation lock, TTS interruption, finalized export, rerecord + undo, failed recording preservation, missing-page routing, background permission cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
