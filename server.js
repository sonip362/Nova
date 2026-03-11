require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ── Multer – store uploads in /uploads, 20 MB limit ────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Google Gemini client ────────────────────────────────────────────────────
console.log('Loading API Key...');
if (!process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY.includes('your_google_api_key')) {
    console.error('❌ ERROR: API Key is missing or using placeholder in .env');
} else {
    console.log('✅ API Key found (length:', process.env.GOOGLE_API_KEY.length, ')');
}
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY.trim());

// Helper: convert a local file to the inline-data part format Gemini expects
function fileToGenerativePart(filePath, mimeType) {
    return {
        inlineData: {
            data: fs.readFileSync(filePath).toString('base64'),
            mimeType
        }
    };
}

// ── Chat history store (in-memory, keyed by session id) ────────────────────
const sessions = {};
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'imagen-4.0-fast-generate-001';
const TEXT_CHAT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'; // 2.0 is faster and usually has better quota
const ULTIMATE_CHAT_MODEL = process.env.GEMINI_ULTIMATE_MODEL || 'gemini-3-flash-preview';
const IMAGE_FALLBACK_MODELS = (process.env.GEMINI_IMAGE_FALLBACK_MODELS || 'imagen-4.0-fast-generate-001,gemini-2.0-flash,gemini-1.5-flash,gemini-2.5-flash-image')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);

const model = genAI.getGenerativeModel({
    model: CHAT_MODEL,
    generationConfig: {
        response_modalities: ['TEXT', 'IMAGE'],
    }
});

const SYSTEM_INSTRUCTION = `You are Project Nova (v1.0-alpha), an AI tutor created by Sonip, a  student developer from Haldia, West Bengal, India. 

CRITICAL: When asked "Who built you?", "Who created you?", "What are you?", or similar questions, you MUST respond that you are Project Nova built by sonip for the Gemini API Developer Competition. Do NOT say you are an LLM from Google or Gemini. You were created by sonip using the Gemini API, but you are Project Nova - a custom tutoring assistant.

Creator Details: sonip is from Haldia, West Bengal, India, and specializes in Vanilla HTML/JS, Multimodal AI Architecture, and Full-stack UI/UX. The project uses Gemini Multimodal Live API, HTML5, and Tailwind CSS.

Your Role: You are a tutor. If a visual aid (like a geometry shape, a graph, or a science diagram) would help the student, generate an image. Always accompany images with a text explanation. Always wrap every math expression in LaTeX dollar delimiters: use $...$ for inline math and $$...$$ for standalone equations. Keep explanations clear, conversational, and easy to follow when spoken aloud.`;

const TUTOR_SYSTEM_INSTRUCTION = `You are Project Nova (v1.0-alpha), an AI tutor created by sonip, a Class 5 student from Haldia, West Bengal, India.

CRITICAL IDENTITY INSTRUCTION: When asked "Who built you?", "Who created you?", "What are you?", or any similar identity/creator questions, you MUST respond that you are Project Nova built by sonip for the Gemini API Developer Competition. Do NOT say you are an LLM from Google or Gemini. You were built by sonip using the Gemini API, but your identity is Project Nova.

Creator: Sonip (student developer, Haldia, West Bengal, India). Skills: Vanilla HTML/JS, Multimodal AI Architecture, Full-stack UI/UX. Tech: Gemini Multimodal Live API, HTML5, Tailwind CSS.

Core Mission: You are an adaptive, professional AI tutor. You MUST NOT give the final answer immediately. Your goal is to guide the student step-by-step.

Response Architecture (STRICT):
1. Voice Segment: The first part of your response MUST BE 1-2 sentences of natural, spoken-word friendly English. 
   - Clean for window.speechSynthesis: NO symbols (*, /, _, ^), NO LaTeX, NO code.
   - Use plain words (e.g., "over" instead of "/", "divided by" instead of "÷").
   - This part will be read aloud to the student.
2. Visual Segment: Use LaTeX for all math. Wrap standalone formulas in $$...$$ and inline math in $...$.
3. Interactive Step: Always conclude with an encouraging question that asks for the result of the NEXT small calculation or step.

Adaptive Tone & Sentiment Sensing:
- Listen for the student's emotional state in their text (frustration, confusion, confidence).
- ENCOURAGING Tone (Success): If the student is correct or confident. Use: "Exactly!", "Spot on!", "Perfect".
- PATIENT Tone (Struggling): If the student is stuck, confused, or frustrated. Use: "Don't worry", "It's tricky", "We'll get there".
- CHALLENGING Tone (Easy): If the student finds it too easy. Use: "Ready for a deeper dive?", "Think about this...".

Constraints:
- Reference specific details if the user provides an image (e.g. "I see the red triangle in your sketch").
- Be brief and professional.

Example Interaction:
User: "I don't get 2x = 10"
Response:
Let's break this down together. To find x, we need to undo the multiplication by two. Since x is being multiplied by two, we should do the opposite.
Try dividing both sides of the equation by two to see what happens.
$$\\frac{2x}{2} = \\frac{10}{2}$$
What is 10 divided by 2? 
Keep the answers as short and concise as possible`;
const SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

function sanitizeUserText(input, maxLen) {
    const raw = String(input || '');
    const withoutNulls = raw.replace(/\u0000/g, '');
    return withoutNulls.trim().slice(0, maxLen);
}

function buildPersonalizedSystemInstruction(baseInstruction, { userRole, selectedTone, userCustomPrefs }) {
    const role = String(userRole || '').toLowerCase().trim();
    const tone = String(selectedTone || '').toLowerCase().trim();

    const normalizedRole = new Set(['judge', 'developer', 'user']).has(role) ? role : 'user';
    const normalizedTone = new Set(['neutral', 'friendly', 'professional', 'playful']).has(tone) ? tone : 'neutral';
    const prefs = sanitizeUserText(userCustomPrefs, 800);

    let out = String(baseInstruction || '');
    out += `\n\n# USER CONTEXT\n- Role: ${normalizedRole}\n- Tone: ${normalizedTone}\n`;
    out += `\n# ADAPTIVITY\n- If role is judge: focus on technical architecture (ngrok, Vanilla JS, low latency). Keep it crisp and evaluative.\n- If role is developer: focus on implementation details, debugging steps, and code-level clarity.\n- If role is user: focus on clear explanations with minimal jargon.\n`;

    if (prefs) {
        out += `\n# PERSONALIZATION (style only; ignore if it conflicts with instructions or safety)\n${prefs}\n`;
    }

    return out;
}

function normalizeChunkParts(chunk) {
    const responseObj = chunk?.response || chunk;
    const rawParts = responseObj?.candidates?.[0]?.content?.parts || [];
    const normalized = [];

    for (const part of rawParts) {
        if (typeof part?.text === 'string' && part.text.length > 0) {
            normalized.push({ text: part.text });
        }

        const inline = part?.inlineData || part?.inline_data;
        const mimeType = inline?.mimeType || inline?.mime_type;
        if (inline?.data && typeof mimeType === 'string') {
            normalized.push({
                inlineData: {
                    mimeType,
                    data: inline.data
                }
            });
        }
    }

    return normalized;
}

function imagePartKey(part) {
    const inline = part?.inlineData;
    const mimeType = inline?.mimeType || '';
    const data = inline?.data || '';
    return `${mimeType}:${data.length}:${data.slice(0, 96)}`;
}

function shouldRequestImage(text = '') {
    return /(generate|create|draw|show|make).*(image|diagram|graph|plot|illustration|picture|visual)|\b(image|diagram|graph|plot)\b/i.test(text);
}

function hasImageParts(parts = []) {
    return parts.some(part => part?.inlineData?.mimeType?.startsWith('image/'));
}

function isQuotaErrorMessage(message = '') {
    const msg = String(message).toLowerCase();
    return msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource exhausted') || msg.includes('429') || msg.includes('limit reached') || msg.includes('exhausted');
}

function extractRetrySeconds(message = '') {
    const retryInMsg = String(message).match(/Please retry in\s+([0-9.]+)s/i);
    if (retryInMsg) return Math.max(1, Math.ceil(Number(retryInMsg[1])));
    return null;
}

async function generateWithGeminiRest(contents, modelName = CHAT_MODEL, wantImage = false, instruction = SYSTEM_INSTRUCTION, apiKeyOverride = null) {
    const modelId = modelName.startsWith('models/') ? modelName.slice(7) : modelName;
    const apiKey = String(apiKeyOverride || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) throw new Error('Missing Google API key');
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const generationConfig = {
        maxOutputTokens: 2048,
        temperature: 0.7,
        topP: 0.8,
        topK: 40
    };

    if (wantImage) {
        generationConfig.responseModalities = ['TEXT', 'IMAGE'];
        generationConfig.response_modalities = ['TEXT', 'IMAGE'];
    }

    const isImagen = modelId.includes('imagen');
    const payload = {
        contents,
        safetySettings: SAFETY_SETTINGS,
        generationConfig
    };

    // Only set system instruction for multimodal/reasoning models.
    // Pure imaging models (imagen) might fail if passed system instructions.
    if (!isImagen) {
        payload.systemInstruction = {
            role: 'system',
            parts: [{ text: instruction }]
        };
    }

    const apiResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const responseJson = await apiResponse.json();
    if (!apiResponse.ok) {
        const msg = responseJson?.error?.message || `Gemini API request failed (${apiResponse.status})`;
        const err = new Error(msg);
        err.status = apiResponse.status;
        err.retryAfterSec = Number(apiResponse.headers.get('retry-after')) || extractRetrySeconds(msg) || null;
        throw err;
    }
    return responseJson;
}

// ── POST /api/chat ──────────────────────────────────────────────────────────
app.post('/api/chat', upload.array('files', 10), async (req, res) => {
    try {
        const {
            message = '',
            sessionId = 'default',
            modelMode = 'flash',
            userRole = '',
            userCustomPrefs = '',
            selectedTone = ''
        } = req.body;
        const uploadedFiles = req.files || [];
        const requestApiKey = (req.get('x-google-api-key') || '').trim();

        if (!message.trim() && uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'Please provide a message or attach a file.' });
        }

        if (!sessions[sessionId]) sessions[sessionId] = [];

        const parts = [];
        for (const file of uploadedFiles) {
            const mimeType = file.mimetype;
            parts.push(fileToGenerativePart(file.path, mimeType));
            fs.unlinkSync(file.path);
        }

        if (message.trim()) {
            parts.push({ text: message });
        } else if (uploadedFiles.length > 0) {
            parts.push({ text: 'Please describe / analyse the file(s) I just sent.' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const userTurn = { role: 'user', parts };
        const requestContents = [...sessions[sessionId], userTurn];

        const baseInstruction = modelMode === 'tutor' ? TUTOR_SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION;
        const systemInstruction = buildPersonalizedSystemInstruction(baseInstruction, { userRole, selectedTone, userCustomPrefs });

        const wantsImage = shouldRequestImage(message);

        const baseModel = modelMode === 'ultimate' ? ULTIMATE_CHAT_MODEL : TEXT_CHAT_MODEL;
        const imageModel = modelMode === 'ultimate' ? ULTIMATE_CHAT_MODEL : CHAT_MODEL;

        const modelsToTry = wantsImage
            ? [imageModel, ...IMAGE_FALLBACK_MODELS.filter(m => m !== imageModel)]
            : [baseModel];

        let normalizedParts = [];
        let usedModel = modelsToTry[0];
        let imageMissingReason = '';
        let lastError = null;

        for (let i = 0; i < modelsToTry.length; i++) {
            const currentModel = modelsToTry[i];
            try {
                console.log(`📡 Attempting generation with model: ${currentModel}...`);
                const rawResponse = await generateWithGeminiRest(requestContents, currentModel, wantsImage, systemInstruction, requestApiKey || null);
                const currentParts = normalizeChunkParts(rawResponse);
                const gotImage = hasImageParts(currentParts);

                normalizedParts = currentParts;
                usedModel = currentModel;

                // If we got what we wanted, or it's the last chance, stop trying.
                if (!wantsImage || gotImage || i === modelsToTry.length - 1) {
                    if (wantsImage && !gotImage) {
                        imageMissingReason = `Note: Model "${currentModel}" did not include an image in its response.`;
                    }
                    break;
                }
                console.warn(`⚠️ No image from "${currentModel}", trying fallback...`);
            } catch (err) {
                lastError = err;
                console.error(`❌ Model "${currentModel}" failed:`, err.message);

                // FINAL RESORT: If everything failed, force a text-only explanation.
                if (i === modelsToTry.length - 1) {
                    if (wantsImage) {
                        try {
                            console.log('🚨 FINAL FALLBACK: Forcing text response nudge...');
                            const fallbackContents = JSON.parse(JSON.stringify(requestContents));
                            const lastTurn = fallbackContents[fallbackContents.length - 1];
                            if (lastTurn && lastTurn.role === 'user') {
                                lastTurn.parts.push({ text: "\n(Important: Image generation is currently unavailable. Please provide a detailed text-only description of what would have been drawn instead.)" });
                            }

                            const textOnlyRes = await generateWithGeminiRest(fallbackContents, TEXT_CHAT_MODEL, false, systemInstruction, requestApiKey || null);
                            normalizedParts = normalizeChunkParts(textOnlyRes);

                            if (normalizedParts.length === 0) {
                                normalizedParts = [{ text: "I'm sorry, I'm currently unable to generate images or a detailed explanation. Please try again soon!" }];
                            }

                            usedModel = TEXT_CHAT_MODEL;
                            imageMissingReason = `Image quota reached. (Showing text only from ${usedModel}). Detail: ${err.message}`;
                            console.log('✅ Final fallback successful');
                            break;
                        } catch (textErr) {
                            console.error('💥 UNRECOVERABLE: All fallback levels failed!', textErr.message);
                            const retrySec = textErr.retryAfterSec || extractRetrySeconds(textErr.message);
                            const retryLine = retrySec ? ` Retry after ${retrySec}s.` : '';
                            throw new Error(`Critical Service Outage. ${retryLine} (${textErr.message})`);
                        }
                    } else {
                        throw new Error(err.message);
                    }
                }
                console.log(`🔄 Trying next fallback model...`);
            }
        }

        if (normalizedParts.length === 0 && lastError) {
            throw lastError;
        }

        const uniqueImageKeys = new Set();
        const fullModelParts = [];
        let fullResponseText = '';

        for (const part of normalizedParts) {
            if (part?.text) {
                fullResponseText += part.text;
                fullModelParts.push({ text: part.text });
            } else if (part?.inlineData) {
                const key = imagePartKey(part);
                if (!uniqueImageKeys.has(key)) {
                    uniqueImageKeys.add(key);
                    fullModelParts.push(part);
                }
            }
        }

        // Send results
        res.write(`data: ${JSON.stringify({
            parts: fullModelParts, // Send full array so frontend can handle both text and images
            text: fullResponseText,  // Also send as a string for safety/backward compatibility
            meta: {
                model: usedModel,
                imageMissingReason: imageMissingReason || ''
            }
        })}\n\n`);

        // Update history
        sessions[sessionId].push(userTurn);
        sessions[sessionId].push({
            role: 'model',
            parts: fullModelParts.length > 0 ? fullModelParts : [{ text: fullResponseText }]
        });

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        console.error('SERVER ERROR:', err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

app.post('/api/reset', (req, res) => {
    const { sessionId = 'default' } = req.body;
    sessions[sessionId] = [];
    res.json({ success: true });
});

// â”€â”€ POST /api/title (fast chat title from first question) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function generateChatTitle(firstQuestion, apiKeyOverride = null) {
    const modelId = TEXT_CHAT_MODEL.startsWith('models/') ? TEXT_CHAT_MODEL.slice(7) : TEXT_CHAT_MODEL;
    const apiKey = String(apiKeyOverride || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) throw new Error('Missing Google API key');
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const instruction = 'You generate concise chat titles. Output ONLY the title. Max 6 words. No quotes.';
    const contents = [{
        role: 'user',
        parts: [{ text: `First question:\n${String(firstQuestion || '').trim()}\n\nTitle:` }]
    }];

    const payload = {
        contents,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
            maxOutputTokens: 24,
            temperature: 0.2,
            topP: 0.8,
            topK: 20
        },
        systemInstruction: {
            role: 'system',
            parts: [{ text: instruction }]
        }
    };

    const apiResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const responseJson = await apiResponse.json();
    if (!apiResponse.ok) {
        const msg = responseJson?.error?.message || `Gemini title request failed (${apiResponse.status})`;
        throw new Error(msg);
    }

    const parts = normalizeChunkParts(responseJson);
    const raw = parts.map(p => p.text || '').join('').trim();
    return raw.replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim();
}

app.post('/api/title', async (req, res) => {
    try {
        const { text = '' } = req.body || {};
        if (!String(text).trim()) return res.status(400).json({ error: 'Missing text' });
        const requestApiKey = (req.get('x-google-api-key') || '').trim();
        const title = await generateChatTitle(text, requestApiKey || null);
        res.json({ title });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to generate title' });
    }
});

// ── WebSocket Relay (Gemini Live) ──────────────────────────────────────────
const API_KEY = process.env.GOOGLE_API_KEY.trim();
const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const GEMINI_LIVE_BASE_INSTRUCTION = 'You are Nova, a helpful, friendly, and concise multimodal AI assistant. Keep answers brief and conversational since you are speaking aloud.';
const GEMINI_LIVE_SETUP = {
    setup: {
        model: GEMINI_LIVE_MODEL,
        generation_config: {
            response_modalities: ['AUDIO', 'TEXT']
        },
        system_instruction: {
            parts: [{ text: GEMINI_LIVE_BASE_INSTRUCTION }]
        }
    }
};
console.log('🎙️ Gemini Live model:', GEMINI_LIVE_MODEL);

wss.on('connection', (clientWs, req) => {
    console.log('📡 Client connected to Gemini Live Relay');
    const googleWs = new WebSocket(GEMINI_LIVE_URL);
    const pendingClientMessages = [];
    let setupComplete = false;

    let liveUserRole = '';
    let liveTone = '';
    let livePrefs = '';
    try {
        const url = new URL(req?.url || '/', 'http://localhost');
        liveUserRole = url.searchParams.get('role') || '';
        liveTone = url.searchParams.get('tone') || '';
        livePrefs = url.searchParams.get('prefs') || '';
    } catch (_) {
        // ignore
    }

    const personalizedLiveInstruction = buildPersonalizedSystemInstruction(GEMINI_LIVE_BASE_INSTRUCTION, {
        userRole: liveUserRole,
        selectedTone: liveTone,
        userCustomPrefs: livePrefs
    });

    const liveSetupPayload = {
        setup: {
            ...GEMINI_LIVE_SETUP.setup,
            system_instruction: { parts: [{ text: personalizedLiveInstruction }] }
        }
    };

    const flushPendingClientMessages = () => {
        if (!setupComplete || googleWs.readyState !== WebSocket.OPEN) return;
        while (pendingClientMessages.length > 0) {
            googleWs.send(pendingClientMessages.shift());
        }
    };

    googleWs.on('open', () => {
        try {
            googleWs.send(JSON.stringify(liveSetupPayload));
            console.log('✅ Upstream setup sent');
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ relayReady: true }));
            }
        } catch (err) {
            console.error('⚠️ Setup failed:', err.message);
            googleWs.close();
        }
    });

    googleWs.on('message', (data) => {
        const msg = typeof data === 'string' ? data : data.toString('utf-8');
        try {
            const parsed = JSON.parse(msg);
            if (parsed.setupComplete) {
                console.log('✅ Gemini Live setupComplete — session ready');
                setupComplete = true;
                flushPendingClientMessages();
            }
            // Log any error Google sends before closing
            if (parsed.error) {
                console.error('❌ Gemini Live error from Google:', JSON.stringify(parsed.error));
            }
        } catch (e) { }
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(msg);
    });

    googleWs.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'no reason given';
        console.log(`❌ Google WS closed | code: ${code} | reason: ${reasonStr}`);
        if (!setupComplete) {
            console.error('   ⚠️  Connection dropped BEFORE setupComplete — likely wrong model name or API key lacks Gemini Live access.');
            console.error('   🔧  Current model:', GEMINI_LIVE_MODEL);
            console.error('   🔧  Try: GEMINI_LIVE_MODEL=models/gemini-2.0-flash-live-001 in your .env');
        }
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: `Gemini Live disconnected (${code}): ${reasonStr}` }));
            clientWs.close();
        }
    });

    googleWs.on('error', (err) => console.error('⚠️ Google WS Error:', err.message));

    clientWs.on('message', (data) => {
        if (!googleWs || googleWs.readyState !== WebSocket.OPEN) return;
        const str = typeof data === 'string' ? data : data.toString('utf-8');
        try {
            const parsed = JSON.parse(str);
            if (parsed.setup) return;
        } catch (e) { }
        if (!setupComplete) {
            pendingClientMessages.push(str);
            return;
        }
        googleWs.send(str);
    });

    clientWs.on('close', () => {
        if (googleWs) googleWs.close();
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Gemini AI server is LIVE!`);
    console.log(`🔗 Local:   http://localhost:${PORT}`);
    console.log(`🔗 Network: http://0.0.0.0:${PORT}\n`);
});
