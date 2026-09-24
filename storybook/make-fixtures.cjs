const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname,'test-fixtures');
fs.mkdirSync(dir,{recursive:true});
// Real, silent PCM WAV data for testing playback transitions without microphone access.
const rate = 8000, frames = rate * 2;
const wav = Buffer.alloc(44+frames*2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(frames*2,40);
const audio = {data:'data:audio/wav;base64,'+wav.toString('base64'),duration:2};
const img = file => 'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'..',file)).toString('base64');
const book = {format:'little-storybook',version:1,title:'재생 검증용 동화',author:'테스트',pages:[
  {image:img('GPT_토끼.png'),text:'첫 번째 장이에요.',audio,previousAudio:null},
  {image:img('GPT_곰돌이.png'),text:'두 번째 장이에요.',audio,previousAudio:null},
  {image:img('GPT_고양이.png'),text:'세 번째 장, 끝!',audio,previousAudio:null}
]};
fs.writeFileSync(path.join(dir,'playback.story.json'),JSON.stringify(book));
fs.writeFileSync(path.join(dir,'invalid.story.json'),'{"format":"incorrect","version":1}');
console.log('Created isolated playback/import fixtures.');
