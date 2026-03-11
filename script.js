
marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    }
});


const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const filePreviewStrip = document.getElementById('filePreviewStrip');
const newChatBtn = document.getElementById('newChat');
const clearBtn = document.getElementById('clearBtn');
const apiKeyBtn = document.getElementById('apiKeyBtn');
const welcomeEl = document.getElementById('welcome');
const dropOverlay = document.getElementById('dropOverlay');
const sidebarEl = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');
const sidebarToggle = document.getElementById('sidebarToggle');
const historyListEl = document.getElementById('historyList');
const micBtn = document.getElementById('micBtn');
const ttsToggleBtn = document.getElementById('ttsToggleBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsApiKeyInput = document.getElementById('settingsApiKey');
const settingsSaveApiKeyBtn = document.getElementById('settingsSaveApiKey');
const settingsClearApiKeyBtn = document.getElementById('settingsClearApiKey');
const customPrefsTextarea = document.getElementById('custom-prefs');
const prefsMeta = document.getElementById('prefsMeta');
const settingsSavePrefsBtn = document.getElementById('settingsSavePrefs');
const settingsResetPrefsBtn = document.getElementById('settingsResetPrefs');
const toneSelect = document.getElementById('toneSelect');
const liveVoiceSourceSelect = document.getElementById('liveVoiceSource');
const liveTtsControls = document.getElementById('liveTtsControls');
const liveTtsVoiceSelect = document.getElementById('liveTtsVoice');
const liveTtsRateInput = document.getElementById('liveTtsRate');
const liveTtsPitchInput = document.getElementById('liveTtsPitch');
const liveTtsRateVal = document.getElementById('liveTtsRateVal');
const liveTtsPitchVal = document.getElementById('liveTtsPitchVal');
const liveTtsTestBtn = document.getElementById('liveTtsTestBtn');


let pendingFiles = [];            // File[] not yet sent
let sessionId = `sess-${Date.now()}`;
let isLoading = false;
let chats = JSON.parse(localStorage.getItem('gemini_chats') || '{}');
let isRecording = false;
let recognition = null;
let baseText = '';
let modelMode = 'flash';
let isTtsEnabled = localStorage.getItem('tts_enabled') === '1';
let userApiKey = (localStorage.getItem('google_api_key') || '').trim();
const MAX_CUSTOM_PREFS_LEN = 800;

function getSavedCustomPrefs() {
    return String(localStorage.getItem('userCustomPrefs') || '');
}

function setSavedCustomPrefs(nextPrefs) {
    const next = String(nextPrefs || '').slice(0, MAX_CUSTOM_PREFS_LEN);
    if (next.trim()) localStorage.setItem('userCustomPrefs', next);
    else localStorage.removeItem('userCustomPrefs');
}

function getSavedTone() {
    return String(localStorage.getItem('selectedTone') || 'neutral') || 'neutral';
}

function setSavedTone(nextTone) {
    const allowed = new Set(['neutral', 'friendly', 'professional', 'playful']);
    const next = String(nextTone || 'neutral').toLowerCase();
    localStorage.setItem('selectedTone', allowed.has(next) ? next : 'neutral');
}

function getLiveVoiceSource() {
    const v = String(localStorage.getItem('live_voice_source') || 'gemini').toLowerCase();
    return (v === 'browser' || v === 'gemini') ? v : 'gemini';
}

function setLiveVoiceSource(next) {
    const v = String(next || 'gemini').toLowerCase();
    localStorage.setItem('live_voice_source', (v === 'browser' || v === 'gemini') ? v : 'gemini');
}

function getLiveTtsVoiceUri() {
    return String(localStorage.getItem('live_tts_voice_uri') || '');
}

function setLiveTtsVoiceUri(next) {
    const v = String(next || '');
    if (v) localStorage.setItem('live_tts_voice_uri', v);
    else localStorage.removeItem('live_tts_voice_uri');
}

function getLiveTtsRate() {
    const n = Number(localStorage.getItem('live_tts_rate') || 1);
    if (!Number.isFinite(n)) return 1;
    return Math.min(1.3, Math.max(0.7, n));
}

function setLiveTtsRate(next) {
    const n = Number(next);
    if (!Number.isFinite(n)) return;
    localStorage.setItem('live_tts_rate', String(Math.min(1.3, Math.max(0.7, n))));
}

function getLiveTtsPitch() {
    const n = Number(localStorage.getItem('live_tts_pitch') || 1);
    if (!Number.isFinite(n)) return 1;
    return Math.min(1.3, Math.max(0.7, n));
}

function setLiveTtsPitch(next) {
    const n = Number(next);
    if (!Number.isFinite(n)) return;
    localStorage.setItem('live_tts_pitch', String(Math.min(1.3, Math.max(0.7, n))));
}

function cancelLiveTts() {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (_) { }
}

function pickSpeechVoiceByUri(voiceUri) {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    if (!voiceUri) return null;
    return voices.find(v => v.voiceURI === voiceUri) || null;
}

function speakLiveTts(text) {
    if (!('speechSynthesis' in window)) return;
    const cleaned = String(text || '').trim();
    if (!cleaned) return;

    cancelLiveTts();

    const u = new SpeechSynthesisUtterance(cleaned);
    u.rate = getLiveTtsRate();
    u.pitch = getLiveTtsPitch();
    const v = pickSpeechVoiceByUri(getLiveTtsVoiceUri());
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
}

function updateLiveVoiceUiVisibility() {
    const mode = getLiveVoiceSource();
    if (liveVoiceSourceSelect) liveVoiceSourceSelect.value = mode;
    if (liveTtsControls) liveTtsControls.hidden = mode !== 'browser';
}

function populateLiveTtsVoices() {
    if (!liveTtsVoiceSelect) return;
    if (!('speechSynthesis' in window)) return;

    const voices = window.speechSynthesis.getVoices() || [];
    const currentUri = getLiveTtsVoiceUri();

    liveTtsVoiceSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default voice';
    liveTtsVoiceSelect.appendChild(defaultOpt);

    voices
        .slice()
        .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''))
        .forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = `${v.name} (${v.lang})`;
            liveTtsVoiceSelect.appendChild(opt);
        });

    liveTtsVoiceSelect.value = voices.some(v => v.voiceURI === currentUri) ? currentUri : '';
}

function updatePrefsMeta() {
    if (!prefsMeta || !customPrefsTextarea) return;
    const len = customPrefsTextarea.value.length;
    prefsMeta.textContent = `${len} / ${MAX_CUSTOM_PREFS_LEN}`;
}

function openSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add('active');

    if (settingsApiKeyInput) settingsApiKeyInput.value = '';
    if (customPrefsTextarea) {
        customPrefsTextarea.value = getSavedCustomPrefs().slice(0, MAX_CUSTOM_PREFS_LEN);
        updatePrefsMeta();
    }
    if (toneSelect) toneSelect.value = getSavedTone();

    updateLiveVoiceUiVisibility();
    if ('speechSynthesis' in window) {
        populateLiveTtsVoices();
        if (typeof window.speechSynthesis.onvoiceschanged !== 'function') {
            // Some browsers only fire this once; safe to assign repeatedly.
            window.speechSynthesis.onvoiceschanged = () => populateLiveTtsVoices();
        }
    }
    if (liveTtsRateInput) liveTtsRateInput.value = String(getLiveTtsRate());
    if (liveTtsPitchInput) liveTtsPitchInput.value = String(getLiveTtsPitch());
    if (liveTtsRateVal) liveTtsRateVal.textContent = getLiveTtsRate().toFixed(2);
    if (liveTtsPitchVal) liveTtsPitchVal.textContent = getLiveTtsPitch().toFixed(2);

    setTimeout(() => {
        if (customPrefsTextarea) customPrefsTextarea.focus();
        else if (settingsApiKeyInput) settingsApiKeyInput.focus();
    }, 50);
}

function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.remove('active');
}

function updateApiKeyBtnUI() {
    if (!apiKeyBtn) return;
    const hasKey = Boolean(userApiKey);
    apiKeyBtn.classList.toggle('has-key', hasKey);
    apiKeyBtn.setAttribute('aria-pressed', String(hasKey));
    const label = hasKey ? 'Settings (API key set)' : 'Settings';
    apiKeyBtn.title = label;
    apiKeyBtn.setAttribute('aria-label', label);
}

if (apiKeyBtn) {
    apiKeyBtn.addEventListener('click', () => {
        openSettingsModal();
    });
    updateApiKeyBtnUI();
}

// Settings modal events
if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', closeSettingsModal);
}
if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });
}
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal?.classList.contains('active')) closeSettingsModal();
});

if (customPrefsTextarea) {
    customPrefsTextarea.maxLength = MAX_CUSTOM_PREFS_LEN;
    customPrefsTextarea.addEventListener('input', updatePrefsMeta);
    updatePrefsMeta();
}

if (settingsSavePrefsBtn) {
    settingsSavePrefsBtn.addEventListener('click', () => {
        setSavedCustomPrefs(customPrefsTextarea?.value || '');
        updatePrefsMeta();
        closeSettingsModal();
    });
}

if (settingsResetPrefsBtn) {
    settingsResetPrefsBtn.addEventListener('click', () => {
        if (customPrefsTextarea) customPrefsTextarea.value = '';
        setSavedCustomPrefs('');
        updatePrefsMeta();
    });
}

if (toneSelect) {
    toneSelect.value = getSavedTone();
    toneSelect.addEventListener('change', () => setSavedTone(toneSelect.value));
}

if (liveVoiceSourceSelect) {
    liveVoiceSourceSelect.value = getLiveVoiceSource();
    liveVoiceSourceSelect.addEventListener('change', () => {
        setLiveVoiceSource(liveVoiceSourceSelect.value);
        updateLiveVoiceUiVisibility();
        if (getLiveVoiceSource() === 'browser') {
            clearLiveAudioQueue();
            populateLiveTtsVoices();
        } else {
            cancelLiveTts();
        }
    });
}

if (liveTtsVoiceSelect) {
    liveTtsVoiceSelect.addEventListener('change', () => setLiveTtsVoiceUri(liveTtsVoiceSelect.value));
}

if (liveTtsRateInput) {
    liveTtsRateInput.value = String(getLiveTtsRate());
    if (liveTtsRateVal) liveTtsRateVal.textContent = getLiveTtsRate().toFixed(2);
    liveTtsRateInput.addEventListener('input', () => {
        setLiveTtsRate(liveTtsRateInput.value);
        if (liveTtsRateVal) liveTtsRateVal.textContent = getLiveTtsRate().toFixed(2);
    });
}

if (liveTtsPitchInput) {
    liveTtsPitchInput.value = String(getLiveTtsPitch());
    if (liveTtsPitchVal) liveTtsPitchVal.textContent = getLiveTtsPitch().toFixed(2);
    liveTtsPitchInput.addEventListener('input', () => {
        setLiveTtsPitch(liveTtsPitchInput.value);
        if (liveTtsPitchVal) liveTtsPitchVal.textContent = getLiveTtsPitch().toFixed(2);
    });
}

if (liveTtsTestBtn) {
    liveTtsTestBtn.addEventListener('click', () => {
        setLiveVoiceSource('browser');
        updateLiveVoiceUiVisibility();
        populateLiveTtsVoices();
        speakLiveTts('This is Nova live voice test.');
    });
}

if (settingsSaveApiKeyBtn) {
    settingsSaveApiKeyBtn.addEventListener('click', () => {
        const next = String(settingsApiKeyInput?.value || '').trim();
        if (!next) return;
        userApiKey = next;
        localStorage.setItem('google_api_key', userApiKey);
        if (settingsApiKeyInput) settingsApiKeyInput.value = '';
        updateApiKeyBtnUI();
        closeSettingsModal();
    });
}

if (settingsClearApiKeyBtn) {
    settingsClearApiKeyBtn.addEventListener('click', () => {
        userApiKey = '';
        localStorage.removeItem('google_api_key');
        if (settingsApiKeyInput) settingsApiKeyInput.value = '';
        updateApiKeyBtnUI();
    });
}


let sidebarOpen = window.innerWidth > 700;

function updateSidebar() {
    if (window.innerWidth <= 700) {
        sidebarEl.classList.toggle('open', sidebarOpen);
        // overlay
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
            overlay.addEventListener('click', () => { sidebarOpen = false; updateSidebar(); });
        }
        overlay.classList.toggle('active', sidebarOpen);
        sidebarEl.classList.remove('collapsed');
    } else {
        sidebarEl.classList.toggle('collapsed', !sidebarOpen);
        sidebarEl.classList.remove('open');
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) overlay.classList.remove('active');
    }
}

[menuBtn, sidebarToggle].forEach(btn =>
    btn.addEventListener('click', () => { sidebarOpen = !sidebarOpen; updateSidebar(); })
);

window.addEventListener('resize', () => {
    if (window.innerWidth > 700) sidebarOpen = true;
    updateSidebar();
});

updateSidebar();

function updateTtsToggleUI() {
    if (!ttsToggleBtn) return;

    ttsToggleBtn.classList.toggle('enabled', isTtsEnabled);
    ttsToggleBtn.setAttribute('aria-pressed', String(isTtsEnabled));
    const label = isTtsEnabled ? 'Mute speech output' : 'Enable speech output';
    ttsToggleBtn.title = label;
    ttsToggleBtn.setAttribute('aria-label', label);
}

if (ttsToggleBtn) {
    ttsToggleBtn.addEventListener('click', () => {
        isTtsEnabled = !isTtsEnabled;
        localStorage.setItem('tts_enabled', isTtsEnabled ? '1' : '0');

        if (!isTtsEnabled && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        updateTtsToggleUI();
    });
    updateTtsToggleUI();
}

// ── Model Selector ──────────────────────────────────────────────
document.querySelectorAll('.model-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.model-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        modelMode = btn.dataset.mode;
        console.log(`Model switched to: ${modelMode}`);
    });
});

// ── Auto-resize textarea ──
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
    updateSendBtn();
});

// ── Send on Enter (Shift+Enter for newline) ──────────────────────
messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        if (!isLoading && (messageInput.value.trim() || pendingFiles.length > 0)) {
            e.preventDefault();
            handleSend();
        } else if (isLoading) {
            e.preventDefault();
        }
    }
});

sendBtn.addEventListener('click', handleSend);

function updateSendBtn() {
    sendBtn.disabled = isLoading || (messageInput.value.trim() === '' && pendingFiles.length === 0);
}

function shouldExpectGeneratedImage(text) {
    if (!text) return false;
    return /(generate|create|draw|show|make).*(image|diagram|graph|plot|illustration|picture|visual)|\b(image|diagram|graph|plot)\b/i.test(text);
}


document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        messageInput.value = chip.dataset.text;
        messageInput.dispatchEvent(new Event('input'));
        messageInput.focus();
    });
});

// â”€â”€ Attach button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files));
    fileInput.value = '';
});

// â”€â”€ Drag & drop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const mainEl = document.getElementById('main');
let dragCounter = 0;

mainEl.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
});
mainEl.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter === 0) dropOverlay.classList.remove('active');
});
mainEl.addEventListener('dragover', e => e.preventDefault());
mainEl.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
});

// â”€â”€ Add files to pending list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function addFiles(files) {
    files.forEach(file => {
        // Limit to 20 MB
        if (file.size > 20 * 1024 * 1024) {
            showError(`"${file.name}" is too large (max 20 MB).`);
            return;
        }
        pendingFiles.push(file);
        renderPreview(file, pendingFiles.length - 1);
    });
    filePreviewStrip.hidden = pendingFiles.length === 0;
    updateSendBtn();
}

function renderPreview(file, index) {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.dataset.index = index;

    if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        item.appendChild(img);
    } else {
        item.classList.add('file-thumb');
        item.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
      </svg>
      <span>${file.name}</span>`;
    }

    const rm = document.createElement('button');
    rm.className = 'preview-remove';
    rm.title = 'Remove';
    rm.textContent = 'X';
    rm.addEventListener('click', () => removeFile(index));
    item.appendChild(rm);

    filePreviewStrip.appendChild(item);
}

function removeFile(index) {
    pendingFiles[index] = null;
    const items = filePreviewStrip.querySelectorAll('.preview-item');
    items.forEach(el => { if (parseInt(el.dataset.index) === index) el.remove(); });
    // Compact array
    pendingFiles = pendingFiles.filter(Boolean);
    // Re-index remaining
    filePreviewStrip.querySelectorAll('.preview-item').forEach((el, i) => el.dataset.index = i);
    filePreviewStrip.hidden = pendingFiles.length === 0;
    updateSendBtn();
}

// â”€â”€ Main send handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleSend() {
    const text = messageInput.value.trim();
    const files = pendingFiles.filter(Boolean);
    const expectGeneratedImage = shouldExpectGeneratedImage(text);

    if (!text && files.length === 0) return;
    if (isLoading) return;
    if (isRecording) stopRecording();

    isLoading = true;
    updateSendBtn();

    // Hide welcome screen
    if (welcomeEl) welcomeEl.remove();

    // Show user message
    appendUserMessage(text, files);

    // Reset input area
    messageInput.value = '';
    messageInput.style.height = 'auto';
    pendingFiles = [];
    filePreviewStrip.innerHTML = '';
    filePreviewStrip.hidden = true;

    // Show typing indicator
    const typingRow = appendTyping();

    try {
        const formData = new FormData();
        formData.append('message', text);
        formData.append('sessionId', sessionId);
        formData.append('modelMode', modelMode);
        formData.append('userRole', String(currentRole || '').trim());
        formData.append('userCustomPrefs', getSavedCustomPrefs());
        formData.append('selectedTone', getSavedTone());
        files.forEach(f => formData.append('files', f));

        // Save user message to local history
        saveToHistory(sessionId, { role: 'user', text, timestamp: Date.now() });

        const chatHeaders = userApiKey ? { 'X-Google-Api-Key': userApiKey } : {};
        const response = await fetch('/api/chat', { method: 'POST', body: formData, headers: chatHeaders });

        typingRow.remove();
        if (!response.ok) throw new Error('Stream request failed');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let modelResponse = '';
        let modelImages = [];
        const modelImageKeys = new Set();
        let imageMissingReason = '';
        let streamError = '';
        let streamComplete = false;
        const modelRow = appendModelMessage('');
        const bubble = modelRow.querySelector('.bubble');
        if (expectGeneratedImage) {
            renderModelBubble(bubble, '', modelImages, { showImageSkeleton: true });
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') {
                        // Save model response to local history
                        saveToHistory(sessionId, { role: 'model', text: modelResponse, timestamp: Date.now() });
                        streamComplete = true;
                        break;
                    }

                    let data;
                    try {
                        data = JSON.parse(dataStr);
                    } catch (e) {
                        continue;
                    }

                    if (data.error) {
                        streamError = data.error;
                        imageMissingReason = data.error;
                        streamComplete = true;
                        break;
                    }

                    if (data.meta?.imageMissingReason) {
                        imageMissingReason = data.meta.imageMissingReason;
                    }
                    let hasNewContent = false;
                    let gotTextFromParts = false;

                    if (Array.isArray(data.parts)) {
                        data.parts.forEach(part => {
                            if (typeof part?.text === 'string' && part.text) {
                                modelResponse += part.text;
                                gotTextFromParts = true;
                                hasNewContent = true;
                            }

                            const inline = part?.inlineData || part?.inline_data;
                            const mimeType = inline?.mimeType || inline?.mime_type;
                            const base64Data = inline?.data;

                            if (base64Data && typeof mimeType === 'string' && mimeType.startsWith('image/')) {
                                const key = `${mimeType}:${base64Data.length}:${base64Data.slice(0, 48)}`;
                                if (!modelImageKeys.has(key)) {
                                    modelImageKeys.add(key);
                                    modelImages.push({ mimeType, data: base64Data });
                                    hasNewContent = true;
                                }
                            }
                        });
                    }

                    // Server may send both `parts` and a convenience `text` field; avoid double-appending.
                    if (data.text && !gotTextFromParts) {
                        modelResponse += data.text;
                        hasNewContent = true;
                    }

                    if (hasNewContent) {
                        renderModelBubble(bubble, modelResponse, modelImages, {
                            showImageSkeleton: expectGeneratedImage && modelImages.length === 0
                        });
                        scrollToBottom();
                    }
                }
            }

            if (streamComplete) break;
        }

        if (streamComplete && modelResponse.trim()) {
            if (modelMode === 'tutor') {
                speakTutorResponse(modelResponse);
            } else {
                speakText(modelResponse);
            }
        }

        if (streamError) {
            showError(streamError);
        }

        renderModelBubble(bubble, modelResponse, modelImages, {
            showImageSkeleton: false,
            showImageMissing: expectGeneratedImage && modelImages.length === 0,
            missingMessage: imageMissingReason,
            isComplete: true
        });
    } catch (err) {
        if (typingRow) typingRow.remove();
        showError(err.message || 'Error occurred during streaming.');
    } finally {
        isLoading = false;
        updateSendBtn();
        messageInput.focus();
    }
}

// Helper to add copy buttons specifically
function addCopyButtons(bubble) {
    bubble.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.copy-btn')) return; // Avoid duplicates
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => {
            const code = pre.querySelector('code')?.innerText || pre.innerText;
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
            });
        });
        pre.style.position = 'relative';
        pre.appendChild(btn);
    });
}

function renderMath(element) {
    if (!element || typeof renderMathInElement !== 'function') return;

    renderMathInElement(element, {
        throwOnError: false,
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    });
}

function renderModelBubble(bubble, text, images = [], options = {}) {
    const showImageSkeleton = Boolean(options.showImageSkeleton);
    const showImageMissing = Boolean(options.showImageMissing);
    const missingMessage = typeof options.missingMessage === 'string' && options.missingMessage.trim()
        ? options.missingMessage.trim()
        : 'Image could not be generated for this response. Try a more specific prompt or check model access.';
    bubble.innerHTML = '';

    if (text) {
        const textBlock = document.createElement('div');
        textBlock.innerHTML = marked.parse(text);
        renderMath(textBlock);
        textBlock.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
        addCopyButtons(textBlock);
        bubble.appendChild(textBlock);
    }

    if (images.length > 0) {
        const imageWrap = document.createElement('div');
        imageWrap.className = 'bubble-generated-images';

        images.forEach(imagePart => {
            const img = document.createElement('img');
            img.src = `data:${imagePart.mimeType};base64,${imagePart.data}`;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '12px';
            img.loading = 'lazy';
            imageWrap.appendChild(img);
        });

        bubble.appendChild(imageWrap);
    }

    if (showImageSkeleton && images.length === 0) {
        const skeletonWrap = document.createElement('div');
        skeletonWrap.className = 'bubble-generated-images';
        const skeleton = document.createElement('div');
        skeleton.className = 'image-skeleton';
        skeleton.innerHTML = '<span>Generating image...</span>';
        skeletonWrap.appendChild(skeleton);
        bubble.appendChild(skeletonWrap);
    } else if (showImageMissing && images.length === 0) {
        const missingWrap = document.createElement('div');
        missingWrap.className = 'bubble-generated-images';
        const missing = document.createElement('div');
        missing.className = 'image-missing-note';
        missing.textContent = missingMessage;
        missingWrap.appendChild(missing);
        bubble.appendChild(missingWrap);
    }

    if (options.isComplete) {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'bubble-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-icon-btn';
        copyBtn.title = 'Copy response';
        copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(text).then(() => {
                const icon = copyBtn.innerHTML;
                copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
                setTimeout(() => { if (copyBtn) copyBtn.innerHTML = icon; }, 2000);
            });
        };

        const retryBtn = document.createElement('button');
        retryBtn.className = 'action-icon-btn';
        retryBtn.title = 'Regenerate response';
        retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
        retryBtn.onclick = () => {
            const hist = chats[sessionId]?.messages;
            if (hist && hist.length >= 2) {
                const lastMsg = hist[hist.length - 2];
                if (lastMsg.role === 'user') {
                    // Remove last two messages from history
                    hist.pop();
                    hist.pop();
                    localStorage.setItem('gemini_chats', JSON.stringify(chats));

                    // Remove them from DOM
                    if (bubble.parentElement) {
                        const row = bubble.parentElement;
                        if (row.previousElementSibling) {
                            row.previousElementSibling.remove(); // user msg
                        }
                        row.remove(); // model msg
                    }

                    // Trigger resend
                    messageInput.value = lastMsg.text;
                    handleSend();
                }
            }
        };

        actionWrap.appendChild(copyBtn);
        actionWrap.appendChild(retryBtn);
        bubble.appendChild(actionWrap);
    }
}

// â”€â”€ Append user message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function appendUserMessage(text, files = []) {
    const row = document.createElement('div');
    row.className = 'message-row user';

    const avatar = document.createElement('div');
    avatar.className = 'avatar user-avatar';
    avatar.textContent = 'U';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    // Audio previews
    const audioFiles = files.filter(f => f.type.startsWith('audio/'));
    const images = files.filter(f => f.type.startsWith('image/'));
    const nonImages = files.filter(f => !f.type.startsWith('image/') && !f.type.startsWith('audio/'));

    if (audioFiles.length) {
        const audioWrap = document.createElement('div');
        audioWrap.className = 'bubble-audio';
        audioFiles.forEach(f => {
            const el = document.createElement('audio');
            el.src = URL.createObjectURL(f);
            el.controls = true;
            audioWrap.appendChild(el);
        });
        bubble.appendChild(audioWrap);
    }

    if (images.length) {
        const imgWrap = document.createElement('div');
        imgWrap.className = 'bubble-images';
        images.forEach(img => {
            const el = document.createElement('img');
            el.src = URL.createObjectURL(img);
            el.alt = img.name;
            imgWrap.appendChild(el);
        });
        bubble.appendChild(imgWrap);
    }

    if (nonImages.length) {
        const fileWrap = document.createElement('div');
        fileWrap.className = 'bubble-files';
        nonImages.forEach(f => {
            const chip = document.createElement('div');
            chip.className = 'bubble-file-chip';
            chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
      </svg>${f.name}`;
            fileWrap.appendChild(chip);
        });
        bubble.appendChild(fileWrap);
    }

    if (text) {
        const p = document.createElement('p');
        p.textContent = text;
        bubble.appendChild(p);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
}

// â”€â”€ Append model message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function appendModelMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row model';

    const avatar = document.createElement('div');
    avatar.className = 'avatar model-avatar';
    avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = text ? '' : '<span class="typing-indicator"><span></span><span></span><span></span></span>';

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);

    if (text) {
        renderModelBubble(bubble, text, [], { isComplete: true });
    }

    scrollToBottom();
    return row;
}

// â”€â”€ Typing indicator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function appendTyping() {
    const row = document.createElement('div');
    row.className = 'message-row model';

    const avatar = document.createElement('div');
    avatar.className = 'avatar model-avatar';
    avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
}

// â”€â”€ Error display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showError(msg) {
    const el = document.createElement('div');
    el.className = 'error-msg';
    el.textContent = `âš ï¸ ${msg}`;
    messagesEl.appendChild(el);
    scrollToBottom();
    setTimeout(() => el.remove(), 8000);
}

// â”€â”€ New chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
newChatBtn.addEventListener('click', resetChat);
clearBtn.addEventListener('click', resetChat);

async function resetChat() {
    await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
    });
    sessionId = `sess-${Date.now()}`;
    messagesEl.innerHTML = '';

    // Restore welcome screen
    const w = document.createElement('div');
    w.className = 'welcome';
    w.id = 'welcome';
    w.innerHTML = `
    <div class="welcome-icon">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
     <h1>Hello, I'm Nova</h1>
                <p>Your multimodal AI assistant. Ask me anything, share an image, or upload a file — I can see and
                    understand it all.</p>
                <div class="welcome-chips">
                    <button class="chip" data-text="Help me solve x^2 - 4 = 0">🎓 Step-by-step math tutor</button>
                    <button class="chip" data-text="Explain quantum computing in simple terms">💡 Explain quantum
                        computing</button>
                    <button class="chip"
                        data-text="Write a Python function that sorts a list of objects by a property">🐍 Write Python
                        code</button>
                    <button class="chip" data-text="What can you see in this image?" data-needs-file="true">🖼️ Analyse
                        an image</button>
                    <button class="chip" data-text="Summarise this document for me" data-needs-file="true">📄 Summarise
                        a file</button>`;
    messagesEl.appendChild(w);

    // Re-attach chip listeners
    w.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            messageInput.value = chip.dataset.text;
            messageInput.dispatchEvent(new Event('input'));
            messageInput.focus();
        });
    });

    pendingFiles = [];
    filePreviewStrip.innerHTML = '';
    filePreviewStrip.hidden = true;
    messageInput.value = '';
    messageInput.style.height = 'auto';
    isLoading = false;
    renderHistory();
    updateSendBtn();
}

// â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function scrollToBottom() {
    requestAnimationFrame(() => {
        messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    });
}

// â”€â”€ History Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function saveToHistory(id, msg) {
    if (!chats[id]) {
        chats[id] = {
            id,
            title: msg.role === 'user' ? msg.text.substring(0, 30) + '...' : 'New Chat',
            titleSource: 'auto',
            messages: [],
            updatedAt: Date.now()
        };
    }
    chats[id].messages.push(msg);
    chats[id].updatedAt = Date.now();
    localStorage.setItem('gemini_chats', JSON.stringify(chats));
    renderHistory();

    // Auto-title using the first user question (fastest/lowest model on the backend).
    if (msg.role === 'user' && chats[id].messages.length === 1 && chats[id].titleSource === 'auto') {
        autoTitleChat(id, msg.text);
    }
}

async function autoTitleChat(id, firstQuestion) {
    const chat = chats[id];
    if (!chat || chat.titleSource !== 'auto') return;

    const currentTitle = chat.title;
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (userApiKey) headers['X-Google-Api-Key'] = userApiKey;

        const res = await fetch('/api/title', {
            method: 'POST',
            headers,
            body: JSON.stringify({ text: String(firstQuestion || '') })
        });
        const data = await res.json().catch(() => ({}));
        const title = String(data?.title || '').trim();
        if (!res.ok || !title) return;

        // Don't overwrite if user already renamed during the async call.
        if (!chats[id] || chats[id].titleSource !== 'auto' || chats[id].title !== currentTitle) return;

        chats[id].title = title;
        chats[id].updatedAt = Date.now();
        localStorage.setItem('gemini_chats', JSON.stringify(chats));
        renderHistory();
    } catch (e) {
        // ignore auto-title failures
    }
}

function renderHistory() {
    if (!historyListEl) return;
    historyListEl.innerHTML = '';

    // Sort by most recent
    const sortedIds = Object.keys(chats).sort((a, b) => chats[b].updatedAt - chats[a].updatedAt);

    sortedIds.forEach(id => {
        const item = document.createElement('div');
        item.className = `history-item ${id === sessionId ? 'active' : ''}`;

        const titleEl = document.createElement('span');
        titleEl.className = 'history-item-text';
        titleEl.textContent = chats[id].title;
        titleEl.onclick = () => loadChat(id);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'history-delete-btn';
        deleteBtn.title = 'Delete chat';
        deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteChat(id);
        };

        item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        item.appendChild(titleEl);
        const renameBtn = document.createElement('button');
        renameBtn.className = 'history-rename-btn';
        renameBtn.title = 'Rename chat';
        renameBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            renameChat(id);
        };
        item.appendChild(renameBtn);
        item.appendChild(deleteBtn);
        historyListEl.appendChild(item);
    });
}

// ── Custom Modal Logic ─────────────────────────────────────────────
const customModal = document.getElementById('customModal');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDescription');
const modalInputWrap = document.getElementById('modalInputWrap');
const modalInput = document.getElementById('modalInput');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

function showCustomModal({ title, description, showInput, inputValue, inputType, onConfirm }) {
    modalTitle.textContent = title || 'Confirm Action';
    modalDesc.textContent = description || '';

    if (showInput) {
        modalInputWrap.hidden = false;
        modalInput.type = inputType || 'text';
        modalInput.value = inputValue || '';
        setTimeout(() => modalInput.focus(), 100);
    } else {
        modalInputWrap.hidden = true;
    }

    customModal.classList.add('active');

    const handleConfirm = () => {
        const val = showInput ? modalInput.value : true;
        cleanup();
        if (onConfirm) onConfirm(val);
    };

    const handleCancel = () => {
        cleanup();
    };

    const cleanup = () => {
        customModal.classList.remove('active');
        modalInput.type = 'text';
        modalConfirm.removeEventListener('click', handleConfirm);
        modalCancel.removeEventListener('click', handleCancel);
        window.removeEventListener('keydown', handleKeydown);
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') handleCancel();
    };

    modalConfirm.addEventListener('click', handleConfirm);
    modalCancel.addEventListener('click', handleCancel);
    window.addEventListener('keydown', handleKeydown);
}

function renameChat(id) {
    showCustomModal({
        title: 'Rename Chat',
        description: 'Enter a new name for this conversation:',
        showInput: true,
        inputValue: chats[id].title,
        onConfirm: (newTitle) => {
            if (newTitle && newTitle.trim() && newTitle !== chats[id].title) {
                chats[id].title = newTitle.trim();
                chats[id].titleSource = 'manual';
                localStorage.setItem('gemini_chats', JSON.stringify(chats));
                renderHistory();
            }
        }
    });
}

function deleteChat(id) {
    showCustomModal({
        title: 'Delete Chat',
        description: 'Are you sure you want to delete this conversation? This cannot be undone.',
        showInput: false,
        onConfirm: (confirmed) => {
            if (confirmed) {
                delete chats[id];
                localStorage.setItem('gemini_chats', JSON.stringify(chats));
                if (id === sessionId) {
                    resetChat();
                } else {
                    renderHistory();
                }
            }
        }
    });
}


async function loadChat(id) {
    if (isLoading) return;
    sessionId = id;
    messagesEl.innerHTML = '';

    // Switch to this session on the server
    // (In a real app we'd fetch from server, here we just trust local)
    // We already send sessionId with every request

    if (chats[id].messages.length === 0) {
        resetChat();
        return;
    }

    if (welcomeEl) welcomeEl.remove();

    chats[id].messages.forEach(msg => {
        if (msg.role === 'user') {
            appendUserMessage(msg.text, []); // We don't store local blobs in history for now
        } else {
            appendModelMessage(msg.text);
        }
    });

    renderHistory();
    if (window.innerWidth <= 700) {
        sidebarOpen = false;
        updateSidebar();
    }
}


if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false; // WAIT FOR FULLY PROCESSED SPEECH
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        if (!isRecording) return;

        // If the computer is talking, stop it to prevent feedback
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }

        let finalDelta = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalDelta += event.results[i][0].transcript;
            }
        }

        if (finalDelta) {
            baseText = (baseText + ' ' + finalDelta.trim()).trim();
        }

        // Display ONLY the committed text
        messageInput.value = baseText;
        messageInput.dispatchEvent(new Event('input'));

        // Auto-scroll/resize textarea
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        messageInput.scrollTop = messageInput.scrollHeight;
    };

    recognition.onerror = () => stopRecording();
    recognition.onend = () => {
        if (isRecording) recognition.start(); // Keep listening until toggled off
    };
}

micBtn.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

async function startRecording() {
    try {
        if (!recognition) {
            showError('Speech recognition is not supported in this browser.');
            return;
        }

        // Cancel any ongoing speech to prevent Nova hearing itself
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        baseText = messageInput.value;
        if (baseText && !baseText.endsWith(' ')) {
            baseText += ' '; // Add space if typing before speaking
        }

        isRecording = true;
        micBtn.classList.add('recording');
        recognition.start();
    } catch (err) {
        showError('Microphone access denied or not available.');
    }
}

function stopRecording() {
    if (recognition) recognition.stop();
    isRecording = false;
    micBtn.classList.remove('recording');
}

function cleanTextForSpeech(text) {
    if (!text) return '';

    let cleaned = text;
    const fracPattern = /\\frac\s*{([^{}]+)}\s*{([^{}]+)}/g;

    // Apply repeatedly so simple chained fractions are normalized.
    let previous = '';
    while (cleaned !== previous) {
        previous = cleaned;
        cleaned = cleaned.replace(fracPattern, '$1 over $2');
    }

    cleaned = cleaned
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, ' $1 ')
        .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
        .replace(/\$([^$]+)\$/g, ' $1 ')
        .replace(/\\times/g, ' times ')
        .replace(/\\cdot/g, ' times ')
        .replace(/\\sqrt\s*{([^{}]+)}/g, ' square root of $1 ')
        .replace(/\\[a-zA-Z]+/g, ' ')
        .replace(/[{}]/g, ' ')
        .replace(/[#*_~>|]/g, ' ')
        .replace(/\n+/g, '. ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned.substring(0, 1200);
}

function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    if (!isTtsEnabled) return;

    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = 1.03;
    utterance.pitch = 1;
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
}

function speakTutorResponse(text) {
    if (!('speechSynthesis' in window)) return;
    if (!isTtsEnabled) return;

    // In Tutor mode, we want to speak the first "Voice Segment".
    // Usually this is everything before the first LaTeX block ($$ or $)
    let speechPart = text.trim();

    // Attempt to extract the first paragraph or generic sentence before math.
    const mathIdx = speechPart.search(/\$\$|\$/);
    if (mathIdx !== -1) {
        speechPart = speechPart.substring(0, mathIdx).trim();
    } else {
        // Just take the first two sentences if no math is found
        const sentences = speechPart.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length > 2) {
            speechPart = sentences.slice(0, 2).join(' ').trim();
        }
    }

    const cleaned = cleanTextForSpeech(speechPart);
    if (!cleaned) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = 'en-US';

    // Adaptive Tone Logic based on keywords in the AI response
    if (text.match(/Great job|Perfect|Exactly|well done|excellent/i)) {
        utterance.pitch = 1.25; // Higher, happier pitch for "Encouraging" tone
        utterance.rate = 1.05;
        console.log("Tone: Encouraging");
    } else if (text.match(/Don't worry|tricky|careful|closer|stuck|take your time/i)) {
        utterance.pitch = 0.95; // Deeper, calmer pitch for "Patient" tone
        utterance.rate = 0.88; // Slower for clarity
        console.log("Tone: Patient");
    } else if (text.match(/Challenge|ready|tough|different way|think about/i)) {
        utterance.pitch = 1.1; // Alert pitch for "Challenging" tone
        utterance.rate = 1.0;
        console.log("Tone: Challenging");
    } else {
        utterance.pitch = 1.0;
        utterance.rate = 1.02;
    }

    window.speechSynthesis.speak(utterance);
}

// â”€â”€ Multimodal Live Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const liveBtn = document.getElementById('liveBtn');
const liveOverlay = document.getElementById('liveOverlay');
const closeLiveBtn = document.getElementById('closeLiveBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const toggleLiveCamera = document.getElementById('toggleLiveCamera');
const toggleLiveMic = document.getElementById('toggleLiveMic');
const liveVideo = document.getElementById('liveVideo');
const thinkingIndicator = document.getElementById('thinkingIndicator');
const cameraOffOverlay = document.getElementById('cameraOffOverlay');
const liveTranscriptEl = document.getElementById('liveTranscript');
const liveWarning = document.getElementById('liveWarning');

// â”€â”€ Live state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let liveWs = null;
let liveStream = null;
let liveAudioCtx = null;         // 16 kHz for mic capture
let livePlaybackCtx = null;      // 24 kHz for playback
let liveMicSource = null;
let liveMicWorkletNode = null;
let liveCaptureInterval = null;
let nextPlayTime = 0;
let currentCameraMode = 'user';
let isLiveMicMuted = false;
let isLiveCameraBlocked = false;
let audioSources = [];           // for barge-in cancellation
let isLiveSessionReady = false;  // true after setupComplete
let liveTranscripts = [];        // {role, text} array for chat storage
let liveTurnModelRow = null;     // main chat row for current live model turn
let liveTurnModelText = '';      // accumulated text for current live model turn

// Browser speech-to-text (for showing user voice as text in Live mode)
let liveSpeechRec = null;
let liveSpeechRecWanted = false;
let liveInterimBubbleEl = null;
let lastFinalLiveUserText = '';

function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function updateLiveInterimUserBubble(text) {
    const cleaned = String(text || '').trim();
    if (!liveTranscriptEl) return;

    if (!cleaned) {
        if (liveInterimBubbleEl) {
            liveInterimBubbleEl.remove();
            liveInterimBubbleEl = null;
        }
        return;
    }

    if (!liveInterimBubbleEl) {
        const el = document.createElement('div');
        el.style.cssText = `padding:8px 14px;border-radius:16px;max-width:80%;font-size:14px;line-height:1.4;animation:fadeIn .2s;word-wrap:break-word;align-self:flex-end;background:rgba(99,102,241,.18);color:#c7d2fe;border-bottom-right-radius:4px;border:1px dashed rgba(99,102,241,.4);`;
        liveTranscriptEl.appendChild(el);
        liveInterimBubbleEl = el;
    }

    liveInterimBubbleEl.textContent = '🎤 ' + cleaned;
    liveTranscriptEl.scrollTop = liveTranscriptEl.scrollHeight;
}

function ensureLiveSpeechRecognition() {
    if (liveSpeechRec) return liveSpeechRec;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event) => {
        let interim = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const t = String(res?.[0]?.transcript || '').trim();
            if (!t) continue;
            if (res.isFinal) finalText = finalText ? `${finalText} ${t}` : t;
            else interim = interim ? `${interim} ${t}` : t;
        }

        if (interim) updateLiveInterimUserBubble(interim);
        if (finalText) {
            updateLiveInterimUserBubble('');
            const cleanedFinal = finalText.replace(/\s+/g, ' ').trim();
            if (cleanedFinal && cleanedFinal !== lastFinalLiveUserText) {
                lastFinalLiveUserText = cleanedFinal;
                addLiveTranscriptBubble('user', cleanedFinal);
            }
        }
    };

    rec.onerror = (e) => {
        // Don't spam UI; just log. We'll retry on 'end' if still wanted.
        console.warn('Live speech recognition error:', e?.error || e);
    };

    rec.onend = () => {
        updateLiveInterimUserBubble('');
        if (!liveSpeechRecWanted) return;
        if (!liveOverlay?.classList.contains('active')) return;
        if (isLiveMicMuted) return;
        try { rec.start(); } catch (_) { }
    };

    liveSpeechRec = rec;
    return rec;
}

function startLiveSpeechRecognition() {
    const rec = ensureLiveSpeechRecognition();
    if (!rec) return;
    liveSpeechRecWanted = true;
    try { rec.start(); } catch (_) { }
}

function stopLiveSpeechRecognition() {
    liveSpeechRecWanted = false;
    updateLiveInterimUserBubble('');
    if (!liveSpeechRec) return;
    try { liveSpeechRec.stop(); } catch (_) { }
}

// Energy threshold for barge-in (Int16 RMS above this = speech)
const BARGE_IN_THRESHOLD = 4500;
const LIVE_CHAT_PREFIX = '[Live] ';

function stripThinking(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function mergeStreamingText(prev, next) {
    const left = String(prev || '');
    const right = String(next || '');
    if (!left) return right;
    if (!right) return left;
    if (right.startsWith(left)) return right;
    if (left.endsWith(right)) return left;
    if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
    return left + ' ' + right;
}

function ensureLiveTurnChatRow() {
    if (liveTurnModelRow) return;
    if (welcomeEl) welcomeEl.remove();
    liveTurnModelRow = appendModelMessage('');
}

function finalizeLiveTurn({ forceSave = false } = {}) {
    if (!liveTurnModelRow) return;

    const bubble = liveTurnModelRow.querySelector('.bubble');
    const text = (liveTurnModelText || '').trim();

    if (text) {
        const finalText = LIVE_CHAT_PREFIX + text;
        renderModelBubble(bubble, finalText, [], { isComplete: true });
        if (forceSave) {
            saveToHistory(sessionId, { role: 'model', text: finalText, timestamp: Date.now() });
        }
    } else {
        liveTurnModelRow.remove();
    }

    liveTurnModelRow = null;
    liveTurnModelText = '';
}


if (liveBtn) liveBtn.addEventListener('click', startLiveMode);
if (closeLiveBtn) closeLiveBtn.addEventListener('click', stopLiveMode);
if (switchCameraBtn) switchCameraBtn.addEventListener('click', switchCamera);
if (toggleLiveCamera) toggleLiveCamera.addEventListener('click', toggleCameraBlocked);
if (toggleLiveMic) toggleLiveMic.addEventListener('click', () => {
    isLiveMicMuted = !isLiveMicMuted;
    toggleLiveMic.classList.toggle('muted', isLiveMicMuted);
    if (liveStream) {
        liveStream.getAudioTracks().forEach(t => {
            t.enabled = !isLiveMicMuted;
        });
    }

    if (isLiveMicMuted) stopLiveSpeechRecognition();
    else if (liveOverlay?.classList.contains('active')) startLiveSpeechRecognition();

    // Also update the UI to reflect the mute state
    if (toggleLiveMic) {
        toggleLiveMic.setAttribute('aria-pressed', String(isLiveMicMuted));
    }
});

function updateLiveCameraUI() {
    const blocked = Boolean(isLiveCameraBlocked);
    if (toggleLiveCamera) {
        toggleLiveCamera.classList.toggle('muted', blocked);
        toggleLiveCamera.setAttribute('aria-pressed', String(blocked));
        toggleLiveCamera.title = blocked ? 'Turn camera on' : 'Turn camera off';
    }
    if (switchCameraBtn) {
        switchCameraBtn.disabled = blocked;
        switchCameraBtn.title = blocked ? 'Camera is off' : 'Switch Camera';
    }
    if (cameraOffOverlay) {
        cameraOffOverlay.hidden = !blocked;
    }
}

async function toggleCameraBlocked() {
    isLiveCameraBlocked = !isLiveCameraBlocked;
    updateLiveCameraUI();

    if (!liveStream) return;

    if (isLiveCameraBlocked) {
        // Stop video + stop frame capture.
        liveStream.getVideoTracks().forEach(t => {
            try { t.enabled = false; } catch (e) { }
            try { t.stop(); } catch (e) { }
            try { liveStream.removeTrack(t); } catch (e) { }
        });
        if (liveCaptureInterval) { clearInterval(liveCaptureInterval); liveCaptureInterval = null; }
        liveVideo.srcObject = null;  // Clear video display
        return;
    }

    // Re-enable camera.
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: currentCameraMode }, aspectRatio: 3 / 4, width: { ideal: 720 }, height: { ideal: 960 } },
            audio: false
        });
        newStream.getVideoTracks().forEach(t => liveStream.addTrack(t));
        liveVideo.srcObject = liveStream;
        if (isLiveSessionReady) startLiveFrameCapture();
    } catch (err) {
        showError('Camera error: ' + err.message);
        isLiveCameraBlocked = true;
        updateLiveCameraUI();
    }
}

// â”€â”€ Start / Stop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startLiveMode() {
    // Disable tutorial when entering live mode
    if (tutorialActive) {
        endTutorial();
    }
    
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        showError('Live mode requires HTTPS or localhost.');
        return;
    }
    liveOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    liveTranscripts = [];
    liveTurnModelRow = null;
    liveTurnModelText = '';
    lastFinalLiveUserText = '';
    updateLiveInterimUserBubble('');
    isLiveCameraBlocked = false;
    isLiveMicMuted = false;
    updateLiveCameraUI();
    startLiveSpeechRecognition();
    // Reset mic UI
    if (toggleLiveMic) {
        toggleLiveMic.classList.remove('muted');
        toggleLiveMic.setAttribute('aria-pressed', 'false');
    }
    nextPlayTime = 0; // Reset play clock for every new session
    
    // Clear transcript UI
    if (liveTranscriptEl) liveTranscriptEl.innerHTML = '';
    if (thinkingIndicator) thinkingIndicator.style.display = 'none';
    
    // Connection warning logic
    if (liveWarning) {
        liveWarning.style.display = 'none';
        // Show after 2 seconds to simulate "detecting" delay
        setTimeout(() => {
            if (liveOverlay.classList.contains('active')) {
                liveWarning.style.display = 'flex';
            }
        }, 2000);
    }

    await initHardware();
}

function clearLiveAudioQueue() {
    audioSources.forEach(src => {
        try { src.stop(0); } catch (e) { }
    });
    audioSources = [];
    nextPlayTime = livePlaybackCtx ? livePlaybackCtx.currentTime : 0;
}

function stopLiveMode() {
    // Persist whatever the AI said during Live Mode into the main chat history.
    finalizeLiveTurn({ forceSave: true });
    stopLiveSpeechRecognition();
    lastFinalLiveUserText = '';

    // Save transcripts to chat history
    if (false && liveTranscripts.length > 0) {
        const userText = liveTranscripts.filter(t => t.role === 'user').map(t => t.text).join('\n');
        const modelText = liveTranscripts.filter(t => t.role === 'model').map(t => t.text).join('\n');
        if (userText) appendUserMessage('[ðŸŽ™ï¸ Live] ' + userText);
        if (modelText) appendModelMessage('[ðŸŽ™ï¸ Live] ' + modelText);
    }

    if (liveWs) { liveWs.close(); liveWs = null; }
    if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
    if (liveCaptureInterval) { clearInterval(liveCaptureInterval); liveCaptureInterval = null; }
    if (liveMicWorkletNode) { try { liveMicWorkletNode.disconnect(); } catch (e) { } liveMicWorkletNode = null; }
    if (liveMicSource) { try { liveMicSource.disconnect(); } catch (e) { } liveMicSource = null; }
    clearLiveAudioQueue();
    if (liveAudioCtx) { liveAudioCtx.close(); liveAudioCtx = null; }
    if (livePlaybackCtx) { livePlaybackCtx.close(); livePlaybackCtx = null; }
    isLiveSessionReady = false;
    liveOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

async function switchCamera() {
    if (isLiveCameraBlocked) return;
    currentCameraMode = (currentCameraMode === 'user' ? 'environment' : 'user');
    try {
        // Stop old video track
        liveStream.getVideoTracks().forEach(t => { liveStream.removeTrack(t); t.stop(); });
        // Get new video track
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: currentCameraMode }, aspectRatio: 3 / 4, width: { ideal: 720 }, height: { ideal: 960 } },
            audio: false
        });
        newStream.getVideoTracks().forEach(t => liveStream.addTrack(t));
        liveVideo.srcObject = liveStream;
    } catch (err) {
        console.warn('Camera switch failed, trying ideal:', err.message);
        // Fallback: some devices don't support 'exact'
        try {
            liveStream.getVideoTracks().forEach(t => { liveStream.removeTrack(t); t.stop(); });
            const fallback = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: currentCameraMode }, aspectRatio: 3 / 4 }, audio: false
            });
            fallback.getVideoTracks().forEach(t => liveStream.addTrack(t));
            liveVideo.srcObject = liveStream;
        } catch (e2) {
            showError('Camera switch failed: ' + e2.message);
        }
    }
}

// â”€â”€ Hardware init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function initHardware() {
    try {
        if (liveStream) liveStream.getTracks().forEach(t => t.stop());
        liveStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: currentCameraMode }, aspectRatio: 3 / 4, width: { ideal: 720 }, height: { ideal: 960 } },
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
        });
        liveVideo.srcObject = liveStream;
        liveStream.getAudioTracks().forEach(t => t.enabled = !isLiveMicMuted);
        updateLiveCameraUI();

        // Connect WebSocket first, then audio after setupComplete
        initLiveWS();
    } catch (err) {
        showError('Camera/mic error: ' + err.message);
        stopLiveMode();
    }
}

// â”€â”€ Transcript helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getLiveTranscriptEl() {
    return liveTranscriptEl;
}

function addLiveTranscriptBubble(role, text) {
    if (!text.trim()) return;
    const el = getLiveTranscriptEl();
    const bubble = document.createElement('div');
    bubble.style.cssText = `padding:8px 14px;border-radius:16px;max-width:80%;font-size:14px;line-height:1.4;animation:fadeIn .3s;word-wrap:break-word;${role === 'user'
        ? 'align-self:flex-end;background:rgba(99,102,241,.25);color:#c7d2fe;border-bottom-right-radius:4px;'
        : 'align-self:flex-start;background:rgba(255,255,255,.1);color:#e2e8f0;border-bottom-left-radius:4px;'
        }`;
    bubble.textContent = (role === 'user' ? 'ðŸŽ¤ ' : 'âœ¨ ') + text;
    el.appendChild(bubble);
    el.scrollTop = el.scrollHeight;
    liveTranscripts.push({ role, text });
}

// â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initLiveWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const roleParam = encodeURIComponent(String(currentRole || ''));
    const toneParam = encodeURIComponent(getSavedTone());
    const prefsParam = encodeURIComponent(getSavedCustomPrefs());
    liveWs = new WebSocket(`${protocol}//${window.location.host}?role=${roleParam}&tone=${toneParam}&prefs=${prefsParam}`);

    liveWs.onopen = () => {
        console.log('Live relay socket open');
    };

    liveWs.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (e) { return; }

        // Server sends setup as the first upstream frame.
        if (data.relayReady) {
            console.log('Relay ready; waiting for setupComplete');
            return;
        }

        if (data.setupComplete) {
            console.log('Gemini Live session established');
            isLiveSessionReady = true;
            initLiveAudio();
            if (liveStream && liveStream.getVideoTracks().length > 0) {
                startLiveFrameCapture();
            }
            if (!isLiveMicMuted) startLiveSpeechRecognition();
            return;
        }

        if (data.error) {
            console.error('Gemini Error:', data.error);
            showError(data.error);
            return;
        }

        if (data.serverContent) {
            if (data.serverContent.interrupted) {
                clearLiveAudioQueue();
                cancelLiveTts();
                return;
            }

            if (data.serverContent.modelTurn?.parts) {
                thinkingIndicator.style.display = 'none';
                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData?.data && (!part.inlineData?.mimeType || part.inlineData.mimeType.startsWith('audio/pcm'))) {
                        if (getLiveVoiceSource() === 'gemini') {
                            playLiveAudio(part.inlineData.data);
                        }
                    }
                    if (part.text) {
                        const cleaned = stripThinking(part.text);
                        if (!cleaned) continue;

                        addLiveTranscriptBubble('model', cleaned);

                        ensureLiveTurnChatRow();
                        liveTurnModelText = mergeStreamingText(liveTurnModelText, cleaned);
                        const bubble = liveTurnModelRow?.querySelector('.bubble');
                        if (bubble) {
                            renderModelBubble(bubble, LIVE_CHAT_PREFIX + liveTurnModelText, [], {});
                        }
                    }
                }
            }

            if (data.serverContent.turnComplete) {
                thinkingIndicator.style.display = 'none';
                if (getLiveVoiceSource() === 'browser' && liveTurnModelText.trim()) {
                    speakLiveTts(liveTurnModelText);
                }
                finalizeLiveTurn({ forceSave: true });
            }
        }
    };

    liveWs.onclose = () => {
        console.log('Live WS closed');
        isLiveSessionReady = false;
        clearLiveAudioQueue();
    };

    liveWs.onerror = (e) => console.error('WS Error:', e);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function initLiveAudio() {
    if (liveAudioCtx) return;

    // Create both contexts inside the user-gesture chain (clicking Live button)
    liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    livePlaybackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });

    // CRITICAL: Explicitly resume — browsers (Chrome on ngrok/HTTPS) auto-suspend AudioContext
    if (liveAudioCtx.state === 'suspended') await liveAudioCtx.resume();
    if (livePlaybackCtx.state === 'suspended') await livePlaybackCtx.resume();

    // Reset play clock relative to the fresh context's real current time
    nextPlayTime = livePlaybackCtx.currentTime;

    console.log(`🔊 Playback AudioContext: ${livePlaybackCtx.state} @ ${livePlaybackCtx.sampleRate}Hz`);

    await liveAudioCtx.audioWorklet.addModule('pcm-processor.js');
    liveMicSource = liveAudioCtx.createMediaStreamSource(liveStream);
    liveMicWorkletNode = new AudioWorkletNode(liveAudioCtx, 'pcm-processor');

    liveMicWorkletNode.port.onmessage = (event) => {
        if (!liveWs || liveWs.readyState !== WebSocket.OPEN || !isLiveSessionReady || isLiveMicMuted) {
            return;
        }

        const payload = event.data || {};
        const pcm = payload.pcm;
        const rms = Number(payload.rms || 0);
        if (!(pcm instanceof ArrayBuffer)) return;

        // Barge-in: user speech immediately stops queued model audio.
        if (rms > BARGE_IN_THRESHOLD) {
            clearLiveAudioQueue();
            cancelLiveTts();
        }

        liveWs.send(JSON.stringify({
            realtime_input: {
                media_chunks: [{
                    mime_type: 'audio/pcm;rate=16000',
                    data: arrayBufferToBase64(pcm)
                }]
            }
        }));
    };

    liveMicSource.connect(liveMicWorkletNode);
    // Mic worklet is intentionally not connected to destination.
}
function startLiveFrameCapture() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 360;
    canvas.height = 480;

    liveCaptureInterval = setInterval(() => {
        if (!liveWs || liveWs.readyState !== WebSocket.OPEN || !isLiveSessionReady) return;
        if (isLiveCameraBlocked || !liveStream || liveStream.getVideoTracks().length === 0) return;
        if (!liveVideo.readyState || liveVideo.readyState < 2) return;
        ctx.drawImage(liveVideo, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
        liveWs.send(JSON.stringify({
            realtime_input: {
                media_chunks: [{ mime_type: "image/jpeg", data: base64 }]
            }
        }));
    }, 1000);
}

// Audio playback (24kHz PCM from Gemini)
async function playLiveAudio(base64) {
    if (!livePlaybackCtx) { console.warn('playLiveAudio: no context'); return; }
    try {
        // CRITICAL: Resume AudioContext — Chrome on ngrok/HTTPS aggressively suspends it
        if (livePlaybackCtx.state === 'suspended') {
            console.log('Resuming suspended AudioContext...');
            await livePlaybackCtx.resume();
        }
        if (livePlaybackCtx.state !== 'running') {
            console.warn('AudioContext not running:', livePlaybackCtx.state);
            return;
        }
        const bytes = base64ToUint8Array(base64);
        const sampleCount = Math.floor(bytes.byteLength / 2);
        if (sampleCount === 0) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const float32 = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            float32[i] = view.getInt16(i * 2, true) / 32768;
        }
        const buf = livePlaybackCtx.createBuffer(1, sampleCount, 24000);
        buf.getChannelData(0).set(float32);
        const src = livePlaybackCtx.createBufferSource();
        src.buffer = buf;
        src.connect(livePlaybackCtx.destination);
        // Clamp nextPlayTime — prevents stale scheduling across sessions
        const now = livePlaybackCtx.currentTime;
        if (nextPlayTime < now) nextPlayTime = now;
        src.start(nextPlayTime);
        nextPlayTime += buf.duration;
        thinkingIndicator.style.display = 'none';
        audioSources.push(src);
        src.onended = () => { audioSources = audioSources.filter(s => s !== src); };
        console.log('Audio chunk: ' + sampleCount + ' samples, ' + buf.duration.toFixed(2) + 's');
    } catch (err) {
        console.error('Playback error:', err);
    }
}
renderHistory();
updateSendBtn();

/* ── Role & Tutorial Logic ────────────────────────────────────────────── */
const homeScreen = document.getElementById('homeScreen');
const tutorialOverlay = document.getElementById('tutorialOverlay');
const spotlight = document.getElementById('spotlight');
const finishTutorialBtn = document.getElementById('finishTutorial');
const skipTutorialBtns = document.querySelectorAll('.skip-tutorial');
// liveBtn and liveOverlay are already defined at line 1080
// messageInput and sendBtn are already defined at lines 15-16
let currentRole = localStorage.getItem('user_role');
let tutorialActive = false;
let currentStep = 0;

function initRoleSelection() {
    if (!homeScreen) {
        console.error('homeScreen element not found');
        return;
    }
    
    if (!currentRole) {
        homeScreen.classList.remove('hidden');
    }

    const roleCards = document.querySelectorAll('.role-card');
    if (roleCards.length === 0) {
        console.error('No role cards found');
        return;
    }

    roleCards.forEach(card => {
        card.addEventListener('click', () => {
            currentRole = card.dataset.role;
            localStorage.setItem('user_role', currentRole);
            homeScreen.classList.add('hidden');
            
            if (currentRole === 'developer') {
                console.log('Developer mode: Skipping tutorial');
            } else {
                playTutorialAudioAndStart();
            }
        });
    });
}

function playTutorialAudioAndStart() {
    const tutorialAudio = document.getElementById('tutorialAudio');
    if (tutorialAudio) {
        tutorialAudio.currentTime = 0;
        tutorialAudio.play().catch(err => {
            console.log('Audio playback failed:', err);
            // If audio fails, start tutorial anyway
            startTutorial();
        });
        
        // Start tutorial when audio ends or after timeout
        tutorialAudio.onended = startTutorial;
        const timeoutId = setTimeout(startTutorial, 10000); // Fallback timeout
        tutorialAudio.onplay = () => {
            // Clear timeout if audio actually plays
            clearTimeout(timeoutId);
        };
    } else {
        startTutorial();
    }
}

function startTutorial() {
    tutorialActive = true;
    tutorialOverlay.classList.add('active');
    
    // Hide skip buttons for judge if strictly following prompt
    if (currentRole === 'judge') {
        skipTutorialBtns.forEach(btn => btn.style.display = 'none');
    } else {
        skipTutorialBtns.forEach(btn => btn.style.display = 'block');
    }
    
    showStep(1);
}

function showStep(step) {
    currentStep = step;
    document.querySelectorAll('.tutorial-step').forEach(s => s.classList.remove('active'));
    
    let target;
    if (step === 1) target = messageInput;
    else if (step === 2) target = sendBtn;
    else if (step === 3) target = clearBtn;
    else if (step === 4) target = historyListEl;
    else if (step === 5) target = ttsToggleBtn;
    else if (step === 6) target = liveBtn;
    else if (step === 7) target = liveBtn;
    else if (step === 8) target = liveBtn;
    
    // Skip to next step if target is not found
    if (!target) {
        console.warn(`Target element not found for tutorial step ${step}, skipping to next step`);
        if (step < 8) {
            showStep(step + 1);
        } else {
            endTutorial();
        }
        return;
    }
    
    const stepEl = document.getElementById(`tutorialStep${step}`);
    
    if (!stepEl) {
        console.warn(`Tutorial step ${step} element not found`);
        return;
    }
    
    if (stepEl && target) {
        stepEl.classList.add('active');
        // Ensure element is visible before calculating rect
        setTimeout(() => {
            positionStep(stepEl, target);
            updateSpotlight(target);
        }, 50);
    }
}

function positionStep(stepEl, target) {
    const rect = target.getBoundingClientRect();
    const margin = 20;
    const isMobile = window.innerWidth <= 768;
    
    let top = rect.top - stepEl.offsetHeight - margin;
    let left = rect.left + (rect.width / 2) - (stepEl.offsetWidth / 2);
    let side = 'top';
    
    // Special case for Step 3 (Live Mode)
    if (currentStep === 3) {
        if (isMobile) {
            // Mobile: Full width box (via CSS), JS only needs to handle arrow
            left = 20; // Matches mobile CSS left: 20px
            top = rect.bottom + margin;
            side = 'bottom';
        } else {
            // Desktop: Center generally, but shift towards the target if it's on the edge
            const screenCenter = window.innerWidth / 2;
            const targetCenter = rect.left + (rect.width / 2);
            // Bias the box position towards the target (50% center, 50% target)
            left = (screenCenter + targetCenter) / 2 - (stepEl.offsetWidth / 2);
            top = rect.bottom + margin;
            side = 'bottom';
        }
    } else {
        // Standard boundary checks for other steps
        if (top < margin) {
            top = rect.bottom + margin;
            side = 'bottom';
        } else if (top + stepEl.offsetHeight > window.innerHeight) {
            top = rect.top - stepEl.offsetHeight - margin;
            side = 'top';
        }
    }
    
    // Boundary checks for horizontal position
    const minLeft = margin;
    const maxLeft = window.innerWidth - stepEl.offsetWidth - margin;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
    
    // Calculate arrow position relative to box left edge
    const targetCenterX = rect.left + (rect.width / 2);
    let arrowPos = targetCenterX - left;
    
    // Clamp arrow position within box
    const arrowMargin = 25;
    const boxWidth = stepEl.offsetWidth;
    if (arrowPos < arrowMargin) arrowPos = arrowMargin;
    if (arrowPos > boxWidth - arrowMargin) arrowPos = boxWidth - arrowMargin;
    
    stepEl.style.top = `${top}px`;
    if (!isMobile) stepEl.style.left = `${left}px`; // Let CSS handle mobile left: 20px
    stepEl.style.setProperty('--arrow-left', `${arrowPos}px`);
    stepEl.setAttribute('data-side', side);
}

function updateSpotlight(target) {
    const rect = target.getBoundingClientRect();
    const padding = 8;
    spotlight.style.top = `${rect.top - padding}px`;
    spotlight.style.left = `${rect.left - padding}px`;
    spotlight.style.width = `${rect.width + (padding * 2)}px`;
    spotlight.style.height = `${rect.height + (padding * 2)}px`;
}

function endTutorial() {
    tutorialActive = false;
    tutorialOverlay.classList.remove('active');
    localStorage.setItem('tutorial_completed', 'true');
}

// Event listeners for tutorial progression
messageInput.addEventListener('input', () => {
    if (tutorialActive && currentStep === 1 && messageInput.value.trim().length > 0) {
        showStep(2);
    }
});

sendBtn.addEventListener('click', () => {
    if (tutorialActive && currentStep === 2) {
        // Wait for the message to be sent and typing to start
        setTimeout(() => showStep(3), 500);
    }
});

// Also handle Enter key for step 2
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && tutorialActive && currentStep === 2) {
        setTimeout(() => showStep(3), 500);
    }
});

finishTutorialBtn.addEventListener('click', endTutorial);
skipTutorialBtns.forEach(btn => btn.addEventListener('click', endTutorial));

document.querySelectorAll('.next-step').forEach(btn => {
    btn.addEventListener('click', () => {
        if (currentStep < 8) {
            showStep(currentStep + 1);
        } else {
            endTutorial();
        }
    });
});

// Handle resize to reposition tutorial elements
window.addEventListener('resize', () => {
    if (tutorialActive) {
        showStep(currentStep);
    }
});

initRoleSelection();
