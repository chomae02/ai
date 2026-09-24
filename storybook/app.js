'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const all = query => [...document.querySelectorAll(query)];
  const names = {rabbit:'토끼',bear:'곰돌이',cat:'고양이',penguin:'펭귄'};
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const player = $('audio-player');
  let book = StoryCore.blank();
  let index = 0, tab = 'edit', revision = 0, exportedRevision = 0, persistedRevision = 0;
  let db = null, persistTimer = null, persistQueue = Promise.resolve(), hasDraft = false;
  let ioBusy = true, recordingState = 'idle', recordSession = null, permissionToken = 0;
  let audioMode = 'none', audioPaused = false, playbackToken = 0, speechToken = 0, utterance = null;
  let voices = [], voiceChosen = false, toastTimer = null, completed = false;
  let dialogResolve = null;
  const locked = () => ioBusy || recordingState !== 'idle';
  const current = () => book.pages[index];
  const resolveImage = source => source.startsWith('art:') ? ART[source.slice(4)] : source;

  function sampleBook() {
    return {title:'작은 숲의 선물',author:'',pages:[
      StoryCore.page('art:rabbit','토끼 루루가 작은 씨앗을 발견했어요.\n“어떤 꽃이 피어날까?”'),
      StoryCore.page('art:bear','곰돌이가 물을 주러 왔어요.\n“우리 함께 꽃을 키우자!”'),
      StoryCore.page('art:cat','따뜻한 햇살 아래 꽃이 활짝 피었어요.\n친구들은 환하게 웃었답니다.')
    ]};
  }

  function toast(message, duration = 4200) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
  }

  function ask(title, message, choices = [{label:'알겠어요',value:true,primary:true}]) {
    if (dialogResolve) { dialogResolve(null); dialogResolve = null; }
    const heading = document.createElement('h2');
    heading.id = 'dialog-heading';
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = message;
    $('dialog-content').replaceChildren(heading,body);
    $('dialog').setAttribute('aria-labelledby','dialog-heading');
    $('dialog-actions').replaceChildren();
    return new Promise(resolve => {
      dialogResolve = resolve;
      for (const choice of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button' + (choice.primary ? ' primary' : '');
        button.textContent = choice.label;
        button.onclick = () => { $('dialog').close(); dialogResolve = null; resolve(choice.value); };
        $('dialog-actions').append(button);
      }
      if (!$('dialog').open) $('dialog').showModal();
    });
  }
  $('dialog').addEventListener('cancel', () => { if (dialogResolve) dialogResolve(null); dialogResolve = null; });

  function drawScene(container, source, decorated = false) {
    container.replaceChildren();
    container.classList.toggle('builtin',decorated);
    container.classList.toggle('empty',!source);
    if (!source) {
      const empty = document.createElement('div');
      empty.className = 'empty-scene';
      const icon = document.createElement('span'); icon.textContent = '🖼️';
      empty.append(icon,document.createTextNode('나의 그림을 넣어 주세요'));
      container.append(empty);
      return;
    }
    const img = document.createElement('img');
    img.alt = `${index+1}번째 이야기 그림`;
    img.src = resolveImage(source);
    img.onerror = () => { img.remove(); container.textContent = '그림을 열 수 없어요. 새 그림을 골라 주세요.'; };
    container.append(img);
    if (decorated) {
      const star = document.createElement('span'); star.className = 'scene-star'; star.textContent = '✦'; star.setAttribute('aria-hidden','true');
      const flower = document.createElement('span'); flower.className = 'scene-flower'; flower.textContent = '🌼'; flower.setAttribute('aria-hidden','true');
      container.append(star,flower);
    }
  }

  function renderPages() {
    $('page-list').replaceChildren();
    book.pages.forEach((page,i) => {
      const button = document.createElement('button');
      button.className = 'page-thumb';
      button.setAttribute('aria-current',String(i === index));
      button.setAttribute('aria-label',`${i+1}번째 페이지${page.audio ? ', 녹음 완료' : ''}`);
      button.disabled = locked();
      const art = document.createElement('div'); art.className = 'thumb-art';
      if (page.image) { const img = document.createElement('img'); img.src = resolveImage(page.image); img.alt = ''; img.loading = 'lazy'; art.append(img); }
      else { const icon = document.createElement('span'); icon.className = 'empty-icon'; icon.textContent = '🖼️'; art.append(icon); }
      const caption = document.createElement('div'); caption.className = 'thumb-caption';
      const label = document.createElement('span'); label.textContent = `${i+1}번째 장`;
      const stamp = document.createElement('span'); stamp.textContent = page.audio ? '★' : '☆'; stamp.setAttribute('aria-hidden','true');
      caption.append(label,stamp); button.append(art,caption);
      button.onclick = () => goPage(i);
      $('page-list').append(button);
    });
    $('page-total').textContent = `${book.pages.length}장`;
  }

  function renderDots(target) {
    target.replaceChildren();
    const start = Math.max(0,Math.min(index - 2,book.pages.length - 5));
    if (start > 0) { const range = document.createElement('span'); range.textContent = '…'; range.className = 'dots-range'; target.append(range); }
    for (let i = start; i < Math.min(start+5,book.pages.length); i++) {
      const button = document.createElement('button'); button.textContent = String(i+1);
      button.className = book.pages[i].audio ? 'recorded' : '';
      button.setAttribute('aria-label',`${i+1}번째 페이지${book.pages[i].audio ? ', 녹음 완료' : ''}`);
      button.setAttribute('aria-current',String(i===index)); button.disabled = locked(); button.onclick = () => goPage(i);
      target.append(button);
    }
    if (start+5 < book.pages.length) { const range = document.createElement('span'); range.textContent = '…'; range.className = 'dots-range'; target.append(range); }
  }

  function render() {
    const p = current();
    const count = book.pages.filter(p => p.audio).length;
    for (const element of all('[data-tab]')) {
      const selected = element.dataset.tab === tab;
      element.setAttribute('aria-selected',String(selected));
      element.tabIndex = selected ? 0 : -1;
      $('panel-'+element.dataset.tab).hidden = !selected;
    }
    $('book-label').textContent = `📚 ${book.title || '나의 동화책'} · ${book.pages.length}장`;
    $('book-title').value = book.title; $('book-author').value = book.author;
    $('editor-page-title').textContent = `${index+1}번째 이야기`;
    $('edit-recorded').textContent = p.audio ? '★ 목소리를 담았어요' : '☆ 목소리를 기다려요';
    $('page-text').value = p.text; updateTextCount();
    drawScene($('edit-scene'),p.image,p.decorated);
    for (const prefix of ['record','play']) {
      drawScene($(prefix+'-scene'),p.image,p.decorated);
      $(prefix+'-page').textContent = `${index+1} / ${book.pages.length}`;
      $(prefix+'-text').textContent = p.text || '여기에 나만의 이야기를 담아 주세요.';
      $(prefix+'-text').classList.toggle('placeholder',!p.text);
      renderDots($(prefix+'-dots'));
    }
    $('record-progress').textContent = `★ ${count} / ${book.pages.length}장`;
    $('play-progress').textContent = `🎙️ ${count} / ${book.pages.length}장`;
    $('play-title').textContent = book.title || '나의 동화책';
    $('narrator').textContent = book.author ? `${book.author}의 목소리로 들려주는 이야기` : '내 목소리로 들려주는 이야기';
    $('undo-recording').hidden = !p.previousAudio;
    $('finish-card').hidden = !completed;
    renderPages(); updateControls();
  }

  function label(id,text) { $(id).querySelector('.action-label').textContent = text; }
  function updateControls() {
    const busy = locked();
    for (const element of all('[data-tab],[data-action],.page-thumb,.page-dots button')) element.disabled = busy;
    for (const id of ['new-book','add-page','pick-image','page-text','book-title','book-author','move-left','move-right','delete-page','go-record','go-play','undo-recording','voice','rate','help-button']) $(id).disabled = busy;
    all('#friend-choices button').forEach(b => { b.disabled = busy; });
    $('add-page').disabled = busy || book.pages.length >= StoryCore.MAX_PAGES;
    $('move-left').disabled = busy || index === 0;
    $('move-right').disabled = busy || index === book.pages.length-1;
    $('delete-page').disabled = busy || book.pages.length === 1;
    all('[data-prev]').forEach(b => { b.disabled = busy || index===0; });
    all('[data-next]').forEach(b => { b.disabled = busy || index===book.pages.length-1; });
    $('tts-button').disabled = busy || !current().text.trim() || !synth;
    $('preview-button').disabled = busy || !current().audio;
    $('record-button').disabled = ioBusy || recordingState === 'saving';
    $('record-button').classList.toggle('active',recordingState==='recording');
    $('tts-button').classList.toggle('active',!!utterance);
    $('preview-button').classList.toggle('active',audioMode==='preview');
    label('tts-button',utterance ? '듣기 멈춤' : '들어 보기');
    label('preview-button',audioMode==='preview' ? '듣기 멈춤' : '내 목소리');
    label('record-button',({idle:'녹음하기',requesting:'취소하기',recording:'녹음 끝',saving:'담는 중…'})[recordingState]);
    $('record-button').querySelector('.action-icon').textContent = recordingState === 'recording' ? '⏹️' : '🎙️';
    $('play-button').disabled = busy;
    $('restart-button').disabled = busy;
    $('play-again').disabled = busy;
    $('play-button').textContent = audioMode === 'book' ? (audioPaused ? '▶ 이어 듣기' : 'Ⅱ 잠깐 멈춤') : (completed ? '↻ 한 번 더 듣기' : index === 0 ? '▶ 동화 시작' : '▶ 여기부터 듣기');
  }

  function updateTextCount() { $('text-count').textContent = `${current().text.length.toLocaleString('ko-KR')} / 5,000`; }
  function changed() {
    revision++; completed = false;
    $('book-label').textContent = `📚 ${book.title || '나의 동화책'} · ${book.pages.length}장`;
    $('draft-state').textContent = db ? '● 이 기기에 임시 보관 중…' : '● 파일로 저장해 주세요';
    clearTimeout(persistTimer); persistTimer = setTimeout(persistDraft,600);
  }
  function persistDraft() {
    clearTimeout(persistTimer);
    if (!db) return Promise.resolve();
    const snapshot = StoryCore.pack(book,ART,false), atRevision = revision;
    persistQueue = persistQueue.catch(() => {}).then(() => new Promise((resolve,reject) => {
      const tx = db.transaction('books','readwrite'); tx.objectStore('books').put(snapshot,'last');
      tx.oncomplete = () => { hasDraft = true; persistedRevision = atRevision; if (atRevision === revision) $('draft-state').textContent = revision===exportedRevision ? '✓ 이 기기에 임시 보관됨' : '✓ 이 기기에 임시 보관됨 · 파일 저장도 해 주세요'; resolve(); };
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    })).catch(() => { $('draft-state').textContent = '임시 보관 공간 부족 · 파일로 저장해 주세요'; });
    return persistQueue;
  }

  async function initDraft() {
    try {
      db = await new Promise((resolve,reject) => {
        const request = indexedDB.open('little-storybook-v1',1);
        request.onupgradeneeded = () => request.result.createObjectStore('books');
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('blocked'));
        request.onsuccess = () => resolve(request.result);
      });
      const saved = await new Promise((resolve,reject) => {
        const request = db.transaction('books').objectStore('books').get('last');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (saved) {
        book = StoryCore.validate(saved,ART); hasDraft = true;
        revision = 1; persistedRevision = 1; exportedRevision = 0;
        $('draft-state').textContent = '✓ 지난 작업을 불러왔어요';
      } else { book = sampleBook(); $('draft-state').textContent = '🌱 예시 동화 · 자유롭게 바꿔 보세요'; }
    } catch {
      book = sampleBook(); $('draft-state').textContent = '파일로 저장하고 불러올 수 있어요';
    } finally { ioBusy = false; render(); }
  }

  function stopSpeech() {
    speechToken++; utterance = null;
    if (synth) synth.cancel();
  }
  function stopMedia() {
    stopSpeech(); playbackToken++; player.pause();
    player.onended = null; player.onerror = null;
    player.removeAttribute('src'); player.load();
    audioMode = 'none'; audioPaused = false;
    updateControls();
  }
  function goPage(next) {
    if (locked() || next < 0 || next >= book.pages.length) return;
    stopMedia(); index = next; completed = false;
    $('record-status').textContent = current().audio ? '★ 내 목소리가 담겨 있어요.' : '듣고, 내 목소리로 읽어 보세요.';
    $('play-status').textContent = '내 목소리로 페이지가 하나씩 넘어가요.';
    render();
  }
  function switchTab(next) {
    if (locked()) return;
    stopMedia(); tab = next; completed = false;
    $('record-status').textContent = current().audio ? '★ 내 목소리가 담겨 있어요.' : '듣고, 내 목소리로 읽어 보세요.';
    $('play-status').textContent = '내 목소리로 페이지가 하나씩 넘어가요.';
    render();
    $('tab-'+next).focus({preventScroll:true});
  }

  function voiceKey(v) { return JSON.stringify([v.voiceURI,v.name,v.lang]); }
  function loadVoices() {
    const previous = $('voice').value;
    voices = synth.getVoices().slice().sort((a,b) => Number(/^ko\b/i.test(b.lang))-Number(/^ko\b/i.test(a.lang)) || a.name.localeCompare(b.name));
    $('voice').replaceChildren(new Option('한국어 기본 목소리',''));
    voices.forEach(v => $('voice').add(new Option(`${v.name} · ${v.lang}`,voiceKey(v))));
    if (voices.some(v => voiceKey(v)===previous)) $('voice').value = previous;
    else if (!voiceChosen) { const korean = voices.find(v => /^ko\b/i.test(v.lang)); $('voice').value = korean ? voiceKey(korean) : ''; }
  }
  function readAloud() {
    if (locked() || !synth) return;
    if (utterance) { stopMedia(); $('record-status').textContent = '듣기를 멈췄어요.'; return; }
    stopMedia();
    const chunks = StoryCore.splitText(current().text);
    if (!chunks.length) return;
    const token = speechToken;
    const voice = voices.find(v => voiceKey(v)===$('voice').value);
    function speak(i) {
      if (token !== speechToken) return;
      if (i >= chunks.length) { utterance = null; $('record-status').textContent = '이제 내 목소리로 읽어 볼까요? 🎙️'; updateControls(); return; }
      const speech = new SpeechSynthesisUtterance(chunks[i]); utterance = speech;
      speech.lang = voice?.lang || 'ko-KR'; if (voice) speech.voice = voice;
      speech.rate = Number($('rate').value);
      speech.onstart = () => { if (token === speechToken) $('record-status').textContent = '🔊 이야기를 듣고 있어요.'; };
      speech.onend = () => speak(i+1);
      speech.onerror = event => {
        if (token !== speechToken) return;
        stopSpeech(); updateControls();
        $('record-status').textContent = '목소리를 재생하지 못했어요.';
        toast(event.error==='network' ? '인터넷 연결을 확인하거나 다른 목소리를 골라 주세요.' : '아래 목소리 설정에서 다른 목소리를 골라 주세요.');
      };
      $('record-status').textContent = '목소리를 준비하고 있어요…'; updateControls();
      try { synth.speak(speech); } catch { stopSpeech(); updateControls(); toast('이 브라우저에서 읽기를 시작하지 못했어요.'); }
    }
    speak(0);
  }

  function toDataURL(blob) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
  function formatTime(seconds) { return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`; }
  function releaseTracks(session) { session?.stream.getTracks().forEach(track => track.stop()); }

  async function recordClick() {
    if (ioBusy || recordingState === 'saving') return;
    if (recordingState === 'recording') { finishRecording(); return; }
    if (recordingState === 'requesting') { permissionToken++; recordingState = 'idle'; $('record-status').textContent = '녹음 준비를 취소했어요.'; updateControls(); return; }
    stopMedia();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      await ask('마이크를 켤 수 없어요','보호자와 함께 확인해 주세요.\n서버 주소는 https://로 열어야 녹음할 수 있어요. PC에서 시험할 때는 localhost도 가능해요.'); return;
    }
    if (!window.MediaRecorder) { await ask('녹음을 지원하지 않아요','최신 Chrome, Edge 또는 Safari에서 다시 열어 주세요.'); return; }
    recordingState = 'requesting'; const token = ++permissionToken;
    $('record-status').textContent = '마이크 사용을 허용해 주세요. 준비되면 녹음이 시작돼요.'; updateControls();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if (token !== permissionToken) { stream.getTracks().forEach(t => t.stop()); return; }
      const types = ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
      const mime = types.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream,mime ? {mimeType:mime} : undefined);
      const session = {recorder,stream,chunks:[],page:current(),started:performance.now(),timer:null,failed:false};
      recordSession = session;
      recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
      recorder.onerror = () => {
        session.failed = true;
        finishRecording();
        if (recorder.state === 'inactive') finalizeRecording(session);
      };
      recorder.onstop = () => finalizeRecording(session);
      stream.getAudioTracks().forEach(track => track.onended = () => { if (recordSession === session && recordingState === 'recording') finishRecording(); });
      recorder.start(1000); recordingState = 'recording';
      $('record-clock').textContent = '00:00'; $('record-clock').hidden = false;
      $('record-status').textContent = '🔴 내 목소리를 담고 있어요. 다 읽으면 ■ 녹음 끝!';
      session.timer = setInterval(() => {
        const seconds = (performance.now()-session.started)/1000;
        $('record-clock').textContent = formatTime(seconds);
        if (seconds >= 300) { finishRecording(); toast('5분 동안 담은 목소리를 저장했어요.'); }
      },250);
      updateControls();
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (token !== permissionToken) return;
      recordingState = 'idle'; recordSession = null; updateControls();
      $('record-status').textContent = '마이크를 켜지 못했어요.';
      const message = error.name === 'NotAllowedError' ? '주소창의 마이크 권한을 허용한 뒤 다시 눌러 주세요.' : error.name === 'NotFoundError' ? '사용할 마이크가 없어요. 마이크를 연결해 주세요.' : '다른 앱이 마이크를 사용 중인지 확인하고 다시 눌러 주세요.';
      await ask('마이크를 확인해 주세요',message);
    }
  }
  function finishRecording() {
    const session = recordSession;
    if (!session || recordingState !== 'recording') return;
    recordingState = 'saving'; session.duration = (performance.now()-session.started)/1000;
    clearInterval(session.timer);
    $('record-status').textContent = '목소리를 이 페이지에 담고 있어요…'; updateControls();
    if (session.recorder.state !== 'inactive') session.recorder.stop();
    releaseTracks(session);
  }
  async function finalizeRecording(session) {
    if (session.finalizing || recordSession !== session) return;
    session.finalizing = true;
    clearInterval(session.timer); releaseTracks(session);
    recordingState = 'saving'; updateControls();
    try {
      const duration = session.duration ?? (performance.now()-session.started)/1000;
      const blob = new Blob(session.chunks,{type:session.recorder.mimeType || session.chunks[0]?.type || 'audio/webm'});
      if (session.failed || blob.size < 100 || duration < .45) throw new Error('다시 한 번, 조금 더 길게 녹음해 주세요.');
      const data = await toDataURL(blob);
      if (!StoryCore.validate({format:'little-storybook',version:1,title:'',author:'',pages:[{image:'',text:'',audio:{data,duration}}]})) return;
      session.page.previousAudio = session.page.audio;
      session.page.audio = {data,duration}; changed();
      $('record-status').textContent = '★ 내 목소리를 담았어요! 🎧 눌러 들어 보세요.';
      toast('참 잘했어요! 목소리가 이 페이지에 담겼어요. 🌼');
    } catch (error) {
      $('record-status').textContent = '이번 녹음은 담지 못했어요. 이전 녹음은 그대로 있어요.';
      toast(error.message || '녹음을 다시 시도해 주세요.');
    } finally {
      recordSession = null; recordingState = 'idle'; $('record-clock').hidden = true;
      render(); await persistDraft();
    }
  }

  function audioError(error, mode, token) {
    if (token !== playbackToken) return;
    if (error?.name === 'AbortError') return;
    if (mode === 'book' && error?.name === 'NotAllowedError') {
      audioPaused = true; $('play-status').textContent = '▶ 이어 듣기를 눌러 주세요.'; updateControls(); return;
    }
    stopMedia();
    const message = '녹음을 재생하지 못했어요. 이 기기에서 다시 녹음하거나 다른 브라우저에서 열어 주세요.';
    $(mode==='book' ? 'play-status' : 'record-status').textContent = message;
    toast(message,6500);
  }
  function previewRecording() {
    if (locked() || !current().audio) return;
    if (audioMode === 'preview') { stopMedia(); $('record-status').textContent = '내 목소리 듣기를 멈췄어요.'; return; }
    stopMedia(); audioMode = 'preview'; const token = playbackToken;
    player.src = current().audio.data;
    player.onended = () => { if (token !== playbackToken) return; audioMode = 'none'; $('record-status').textContent = '멋진 내 목소리예요. 🌷'; updateControls(); };
    player.onerror = () => audioError(null,'preview',token);
    $('record-status').textContent = '🎧 내 목소리를 듣고 있어요.'; updateControls();
    player.play().catch(error => audioError(error,'preview',token));
  }
  async function startStory() {
    if (locked()) return;
    const missing = StoryCore.missing(book,index);
    if (missing.length) {
      const answer = await ask('아직 목소리를 기다려요 🎙️',`${missing.map(i => i+1).slice(0,12).join(', ')}번째 장${missing.length>12 ? ' 외' : ''}에 녹음이 없어요.\n목소리를 담으면 끝까지 이어서 들을 수 있어요.`,[{label:'나중에',value:false},{label:'녹음하러 가기',value:true,primary:true}]);
      if (answer) { index = missing[0]; switchTab('record'); }
      return;
    }
    stopMedia(); completed = false; $('finish-card').hidden = true;
    audioMode = 'book'; const token = playbackToken;
    playStoryPage(token);
  }
  function playStoryPage(token) {
    if (token !== playbackToken || audioMode !== 'book') return;
    audioPaused = false;
    render();
    player.src = current().audio.data;
    player.onerror = () => audioError(null,'book',token);
    player.onended = () => {
      if (token !== playbackToken || audioMode !== 'book') return;
      if (index+1 < book.pages.length) { index++; playStoryPage(token); }
      else {
        audioMode = 'none'; completed = true;
        $('play-status').textContent = '🌟 마지막 장까지 모두 들었어요!';
        $('finish-copy').textContent = `${book.author || '나'}의 소중한 목소리를 파일로 간직해요.`;
        $('finish-card').hidden = false; $('finish-card').classList.add('celebrate'); updateControls();
        $('finish-card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'nearest'});
      }
    };
    $('play-status').textContent = `🎧 ${index+1}번째 이야기를 듣고 있어요. 끝나면 다음 장으로 넘어가요.`;
    player.play().catch(error => audioError(error,'book',token));
  }
  function toggleStory() {
    if (locked()) return;
    if (audioMode !== 'book') { if (completed) index = 0; startStory(); return; }
    if (audioPaused) {
      const token = playbackToken; audioPaused = false;
      $('play-status').textContent = `🎧 ${index+1}번째 이야기를 듣고 있어요.`;
      player.play().catch(error => audioError(error,'book',token));
    } else { player.pause(); audioPaused = true; $('play-status').textContent = '잠깐 쉬어 가요. ▶ 누르면 이어서 들어요.'; }
    updateControls();
  }

  async function saveBook() {
    if (locked()) return;
    stopMedia();
    const savedRevision = revision;
    // Construct the file synchronously so native save/share retains the tap gesture.
    const blob = new Blob([JSON.stringify(StoryCore.pack(book,ART,true))],{type:'application/json'});
    if (blob.size > 200*1024*1024) { toast('작업 파일이 200MB를 넘었어요. 책을 나누거나 그림 크기를 줄여 주세요.',6500); return; }
    const filename = StoryCore.filename(book.title);
    ioBusy = true; updateControls();
    let success = false, usedDownload = false;
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await window.showSaveFilePicker({suggestedName:filename,types:[{description:'내 목소리 동화책',accept:{'application/json':['.json']}}]});
        const writable = await handle.createWritable();
        await writable.write(blob); await writable.close(); success = true;
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = filename;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url),120000); success = true; usedDownload = true;
      }
      if (success) {
        exportedRevision = savedRevision;
        $('draft-state').textContent = usedDownload ? '↓ 다운로드 요청됨 · 파일 앱에서 확인해 주세요' : '✓ 작업 파일 저장 완료';
        toast(usedDownload ? '파일을 내려받아요. 휴대폰·태블릿의 파일 앱 또는 다운로드 폴더를 확인해 주세요.' : '그림, 글, 목소리를 한 파일에 저장했어요. 💾',6000);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        const download = await ask('저장 창을 열지 못했어요','다운로드 방식으로 이 기기에 저장할까요?',[{label:'닫기',value:false},{label:'내려받기',value:true,primary:true}]);
        if (download) {
          const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url),120000); exportedRevision = savedRevision; toast('다운로드 폴더에서 동화책 파일을 확인해 주세요.');
        }
      }
    } finally { ioBusy = false; updateControls(); }
  }

  async function chooseBook() {
    if (locked()) return;
    stopMedia();
    if (revision !== exportedRevision || hasDraft) {
      const answer = await ask('다른 동화책을 열까요?','불러오면 지금 책이 바뀌어요.\n간직할 책은 먼저 기기에 저장해 주세요.',[{label:'지금 책 유지',value:false},{label:'다른 책 고르기',value:true,primary:true}]);
      if (!answer) return;
    }
    $('book-input').value = ''; $('book-input').click();
  }
  async function importBook(file) {
    if (!file || locked()) return;
    if (file.size > 200*1024*1024) { toast('200MB 이하의 동화책 파일을 골라 주세요.'); return; }
    ioBusy = true; updateControls();
    try {
      const restored = StoryCore.validate(JSON.parse(await file.text()),ART);
      stopMedia(); book = restored; index = 0; completed = false; revision++; exportedRevision = revision;
      await persistDraft(); render();
      $('play-status').textContent = '불러온 내 목소리 동화책을 들어 보세요.';
      toast('그림, 글, 목소리를 모두 불러왔어요! 📖');
    } catch { await ask('이 파일은 열 수 없어요','이 동화책에서 저장한 .story.json 파일을 골라 주세요.\n지금 만들던 책은 그대로 있어요.'); }
    finally { ioBusy = false; render(); }
  }

  async function uploadImage(file) {
    if (!file || locked()) return;
    if (file.size > 25*1024*1024) { toast('25MB 이하의 그림을 골라 주세요.'); return; }
    ioBusy = true; updateControls();
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url;
      await img.decode();
      if (!img.naturalWidth || img.naturalWidth*img.naturalHeight > 60000000) throw new Error('too large');
      const scale = Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth*scale); canvas.height = Math.round(img.naturalHeight*scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fffdf7'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
      current().image = canvas.toDataURL('image/jpeg',.88); current().decorated = false; changed(); render(); toast('이야기 그림을 넣었어요. 🖼️');
    } catch { toast('그림을 열지 못했어요. JPG, PNG 또는 WebP 그림을 골라 주세요.'); }
    finally { URL.revokeObjectURL(url); ioBusy = false; render(); }
  }

  all('[data-art]').forEach(img => { img.src = ART[img.dataset.art]; });
  Object.entries(names).forEach(([key,name]) => {
    const button = document.createElement('button'); button.setAttribute('aria-label',`${name} 그림 넣기`); button.title = name;
    const img = document.createElement('img'); img.src = ART[key]; img.alt = ''; button.append(img);
    button.onclick = () => { if (locked()) return; current().image = 'art:'+key; current().decorated = true; changed(); render(); };
    $('friend-choices').append(button);
  });
  all('[data-tab]').forEach(button => button.onclick = () => switchTab(button.dataset.tab));
  $('tab-edit').parentElement.addEventListener('keydown',event => {
    if (locked() || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const order = ['edit','record','play'];
    const next = event.key==='Home' ? 0 : event.key==='End' ? 2 : (order.indexOf(tab)+(event.key==='ArrowRight'?1:2))%3;
    switchTab(order[next]);
  });
  all('[data-action="save"]').forEach(button => button.onclick = saveBook);
  all('[data-action="open"]').forEach(button => button.onclick = chooseBook);
  all('[data-prev]').forEach(button => button.onclick = () => goPage(index-1));
  all('[data-next]').forEach(button => button.onclick = () => goPage(index+1));
  $('go-record').onclick = () => switchTab('record'); $('go-play').onclick = () => switchTab('play');
  $('book-title').oninput = event => { book.title = event.target.value; changed(); };
  $('book-author').oninput = event => { book.author = event.target.value; changed(); };
  $('page-text').oninput = event => { current().text = event.target.value; changed(); updateTextCount(); };
  $('pick-image').onclick = () => { $('image-input').value = ''; $('image-input').click(); };
  $('image-input').onchange = event => uploadImage(event.target.files[0]);
  $('book-input').onchange = event => importBook(event.target.files[0]);
  $('add-page').onclick = () => {
    if (locked() || book.pages.length>=StoryCore.MAX_PAGES) return;
    stopMedia(); book.pages.splice(index+1,0,StoryCore.page()); index++; changed(); render();
    $('page-list').querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  };
  $('move-left').onclick = () => {
    if (locked() || index===0) return;
    [book.pages[index-1],book.pages[index]]=[book.pages[index],book.pages[index-1]]; index--; changed(); render();
  };
  $('move-right').onclick = () => {
    if (locked() || index===book.pages.length-1) return;
    [book.pages[index+1],book.pages[index]]=[book.pages[index],book.pages[index+1]]; index++; changed(); render();
  };
  $('delete-page').onclick = async () => {
    if (locked() || book.pages.length===1) return;
    const answer = await ask('이 장을 지울까요?',`${index+1}번째 장의 그림, 글, 목소리가 함께 지워져요.`,[{label:'그대로 둘래요',value:false},{label:'이 장 지우기',value:true}]);
    if (!answer) return;
    book.pages.splice(index,1); index=Math.min(index,book.pages.length-1); changed(); render();
  };
  $('new-book').onclick = async () => {
    if (locked()) return;
    const answer = await ask('새 이야기를 만들까요?','지금 책을 간직하려면 먼저 기기에 저장해 주세요.',[{label:'지금 책 유지',value:false},{label:'새 책 만들기',value:true,primary:true}]);
    if (!answer) return;
    stopMedia(); book=StoryCore.blank(); index=0; changed(); render(); $('book-title').focus();
  };
  $('tts-button').onclick = readAloud; $('record-button').onclick = recordClick; $('preview-button').onclick = previewRecording;
  $('undo-recording').onclick = () => {
    if (locked() || !current().previousAudio) return;
    stopMedia(); const p=current(); [p.audio,p.previousAudio]=[p.previousAudio,p.audio]; changed(); render();
    $('record-status').textContent = '이전 목소리로 바꿨어요. 🎧 눌러 들어 보세요.';
  };
  $('voice').onchange = () => { voiceChosen=true; };
  $('rate').oninput = () => { $('rate-label').textContent=Number($('rate').value).toFixed(1)+'배'; };
  $('play-button').onclick=toggleStory;
  $('restart-button').onclick=$('play-again').onclick=() => { if(locked())return; stopMedia(); index=0; completed=false; render(); startStory(); };
  $('help-button').onclick = () => ask('보호자 안내',
    '① 책 만들기: 그림을 고르고 글을 써 주세요.\n② 목소리 담기: TTS를 들은 뒤 아이의 목소리를 녹음해요.\n③ 동화 듣기: 녹음이 끝나면 다음 장으로 넘어가요.\n\n💾 기기에 저장: 그림·글·녹음을 한 개의 .story.json 파일로 내려받아요. 불러오기에서 이 파일을 선택하면 복원돼요. 태블릿·휴대폰에서는 파일 앱이나 다운로드 폴더를 확인해 주세요. 저장 창이나 미리보기가 열리면 기기의 파일 저장 메뉴를 이용해 주세요.\n\n작업은 이 브라우저에도 임시 보관하지만, 오래 간직할 책은 꼭 파일로 저장해 주세요. 비공개 모드나 사이트 데이터 삭제 시 임시 작업은 사라질 수 있어요. 서버에는 그림과 녹음을 업로드하지 않아요.\n\n🎙️ 서버는 HTTPS로 열고 마이크 사용을 허용해 주세요. 녹음은 한 장에 최대 5분이며, 화면을 벗어나면 진행 중인 녹음을 마무리해요. 한 책은 최대 100장, 작업 파일은 200MB까지예요. 사진은 긴 쪽 1,600픽셀로 줄여 담아요.\n\n🔊 TTS 목소리는 기기마다 다르며 일부는 인터넷을 사용해요. 내장 목소리가 없으면 기기의 한국어 음성을 설치해 주세요. 다른 기기로 옮긴 녹음은 브라우저의 오디오 형식 지원에 따라 재생이 달라질 수 있어요.'
  );
  document.addEventListener('visibilitychange',() => {
    if (!document.hidden) return;
    if (recordingState==='requesting') { permissionToken++; recordingState='idle'; $('record-status').textContent='녹음 준비를 취소했어요.'; updateControls(); }
    if (recordingState==='recording') finishRecording();
    if (audioMode==='book') { player.pause(); audioPaused=true; $('play-status').textContent='▶ 이어 듣기를 눌러 주세요.'; updateControls(); }
    else if (audioMode==='preview' || utterance) stopMedia();
    persistDraft();
  });
  window.addEventListener('pagehide',() => { permissionToken++; if(recordingState==='recording')finishRecording(); releaseTracks(recordSession); stopSpeech(); player.pause(); });
  window.addEventListener('beforeunload',event => {
    if (recordingState!=='idle' || ioBusy || (revision!==persistedRevision && revision!==exportedRevision)) { event.preventDefault(); event.returnValue=''; }
  });
  if (synth) { loadVoices(); synth.addEventListener('voiceschanged',loadVoices); }
  else $('record-status').textContent='이 브라우저는 TTS를 지원하지 않아요. 녹음은 할 수 있어요.';
  render(); initDraft();
})();
