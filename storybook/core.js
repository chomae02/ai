'use strict';
const StoryCore = (() => {
  const MAX_PAGES = 100;
  const uid = () => globalThis.crypto?.randomUUID?.() || 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const page = (image = '', text = '') => ({id:uid(),image,text,decorated:image.startsWith('art:'),audio:null,previousAudio:null});
  function blank() { return {title:'나의 동화책',author:'',pages:[page()]}; }
  function splitText(text) {
    const chunks = [];
    const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]*|[.!?。！？\n]+/gu) || [];
    for (const sentence of sentences) {
      const chars = Array.from(sentence.trim());
      for (let start = 0; start < chars.length;) {
        let end = Math.min(start + 140, chars.length);
        if (end < chars.length) {
          for (let cursor = end; cursor > start + 50; cursor--) {
            if (/\s/u.test(chars[cursor - 1])) { end = cursor; break; }
          }
        }
        const chunk = chars.slice(start,end).join('').trim();
        if (chunk) chunks.push(chunk);
        start = end;
      }
    }
    return chunks;
  }
  function validMedia(data, type, assets) {
    if (type === 'image' && data === '') return true;
    if (type === 'image' && typeof data === 'string' && data.startsWith('art:')) return !!assets[data.slice(4)];
    if (typeof data !== 'string') return false;
    const header = type === 'image' ? /^data:image\/(png|jpeg|webp|gif);base64,/i : /^data:audio\/(webm|mp4|ogg|mpeg|wav|x-wav|aac)(?:;codecs=[a-z0-9., _-]+)?;base64,/i;
    const match = data.match(header);
    if (!match) return false;
    const body = data.slice(match[0].length);
    return body.length > 0 && body.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(body);
  }
  function validate(raw, assets = {}) {
    if (!raw || raw.format !== 'little-storybook' || raw.version !== 1) throw new Error('이 동화책에서 저장한 .story.json 파일을 골라 주세요.');
    if (typeof raw.title !== 'string' || raw.title.length > 100 || typeof raw.author !== 'string' || raw.author.length > 40) throw new Error('책 제목이나 이름을 확인해 주세요.');
    if (!Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > MAX_PAGES) throw new Error('책은 1~100장까지 불러올 수 있어요.');
    function audio(value) {
      if (value == null) return null;
      if (!validMedia(value.data,'audio',assets) || !Number.isFinite(value.duration) || value.duration < 0 || value.duration > 3600) throw new Error('녹음 파일 정보가 올바르지 않아요.');
      return {data:value.data,duration:value.duration};
    }
    return {title:raw.title,author:raw.author,pages:raw.pages.map(p => {
      if (!p || typeof p.text !== 'string' || p.text.length > 5000 || !validMedia(p.image,'image',assets)) throw new Error('페이지의 그림이나 글 정보가 올바르지 않아요.');
      return {...page(p.image,p.text),decorated:p.decorated===true || p.image.startsWith('art:'),audio:audio(p.audio),previousAudio:audio(p.previousAudio)};
    })};
  }
  function pack(book, assets = {}, portable = true) {
    return {format:'little-storybook',version:1,savedAt:new Date().toISOString(),title:book.title,author:book.author,pages:book.pages.map(p => ({
      image:portable && p.image.startsWith('art:') ? assets[p.image.slice(4)] : p.image,
      text:p.text,decorated:p.decorated===true || p.image.startsWith('art:'),audio:p.audio,previousAudio:p.previousAudio || null
    }))};
  }
  function missing(book, start = 0) { return book.pages.slice(start).map((p,i) => p.audio ? null : start+i).filter(i => i !== null); }
  function filename(title) { return (title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,70) || '나의 동화책') + '.story.json'; }
  return {MAX_PAGES,uid,page,blank,splitText,validate,pack,missing,filename};
})();
