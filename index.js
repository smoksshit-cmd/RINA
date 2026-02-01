// Rina Image Generator Extension for SillyTavern
// Author: smoksshit-cmd

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const extensionName = 'rina-image-gen';
const extensionFolderPath = `scripts/extensions/third_party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    useNanoBanana: true,
    useNovelAI: false,
    nanoBananaUrl: '',
    novelAIUrl: '',
    positivePrompt: '',
    negativePrompt: 'low quality, bad anatomy, worst quality, blurry',
    stylePrompt: '',
    extractCharacterAppearance: true,
    extractUserAppearance: true,
    extractClothingFromChat: true,
    extractSceneContext: true,
    width: 512,
    height: 768,
    steps: 28,
    scale: 5,
    sampler: 'k_euler',
};

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }
}

function getSettings() {
    return extension_settings[extensionName];
}

function extractAppearanceFromCard(description) {
    if (!description) return '';
    
    const patterns = [
        /appearance[:\s]*([^]*?)(?=personality|background|scenario|$)/i,
        /looks?[:\s]*([^]*?)(?=personality|background|scenario|$)/i,
        /physical[:\s]*([^]*?)(?=personality|background|scenario|$)/i,
        /внешность[:\s]*([^]*?)(?=характер|история|сценарий|$)/i,
    ];
    
    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match?.[1]) {
            return match[1].trim().substring(0, 500);
        }
    }
    return description.substring(0, 300);
}

function extractClothingFromMessages(messages) {
    const keywords = [
        'wearing', 'dressed', 'clothes', 'outfit', 'shirt', 'pants', 'dress',
        'jacket', 'coat', 'skirt', 'jeans', 'uniform', 'suit', 'blouse',
        'одет', 'наряд', 'платье', 'костюм', 'рубашк', 'брюк', 'юбк'
    ];
    
    const recent = messages.slice(-10);
    const found = [];
    
    for (const msg of recent) {
        const text = (msg.mes || '').toLowerCase();
        for (const kw of keywords) {
            if (text.includes(kw)) {
                const sentences = text.split(/[.!?]/);
                for (const s of sentences) {
                    if (s.includes(kw)) found.push(s.trim());
                }
            }
        }
    }
    return found.slice(0, 3).join(', ');
}

function extractSceneContext(message) {
    if (!message) return '';
    const clean = message.replace(/"[^"]*"/g, '').replace(/«[^»]*»/g, '');
    const parts = [];
    
    for (const match of clean.matchAll(/\*([^*]+)\*/g)) parts.push(match[1].trim());
    for (const match of clean.matchAll(/\[([^\]]+)\]/g)) parts.push(match[1].trim());
    
    return parts.slice(0, 5).join(', ') || clean.substring(0, 200);
}

function buildPrompt(ctx) {
    const s = getSettings();
    const parts = [];
    
    if (s.positivePrompt) parts.push(s.positivePrompt);
    if (s.stylePrompt) parts.push(`[STYLE: ${s.stylePrompt}]`);
    
    if (s.extractCharacterAppearance && ctx.charDesc) {
        const app = extractAppearanceFromCard(ctx.charDesc);
        if (app) parts.push(`[Character: ${app}]`);
    }
    
    if (s.extractUserAppearance && ctx.userDesc) {
        const app = extractAppearanceFromCard(ctx.userDesc);
        if (app) parts.push(`[User: ${app}]`);
    }
    
    if (s.extractClothingFromChat && ctx.messages) {
        const cloth = extractClothingFromMessages(ctx.messages);
        if (cloth) parts.push(`[Clothing: ${cloth}]`);
    }
    
    if (s.extractSceneContext && ctx.lastMsg) {
        const scene = extractSceneContext(ctx.lastMsg);
        if (scene) parts.push(`[Scene: ${scene}]`);
    }
    
    return parts.join(', ');
}

async function generateViaNanoBanana(prompt, negative) {
    const s = getSettings();
    if (!s.nanoBananaUrl) throw new Error('Nano Banana URL not set');
    
    const res = await fetch(s.nanoBananaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            negative_prompt: negative,
            width: s.width,
            height: s.height,
            steps: s.steps,
            cfg_scale: s.scale,
            sampler_name: s.sampler,
        }),
    });
    
    if (!res.ok) throw new Error(`Nano Banana: ${res.status}`);
    const data = await res.json();
    return data.image || data.images?.[0] || data;
}

async function generateViaNovelAI(prompt, negative) {
    const s = getSettings();
    if (!s.novelAIUrl) throw new Error('NovelAI URL not set');
    
    const res = await fetch(s.novelAIUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input: prompt,
            model: 'nai-diffusion-3',
            parameters: {
                width: s.width,
                height: s.height,
                steps: s.steps,
                scale: s.scale,
                sampler: s.sampler,
                negative_prompt: negative,
                n_samples: 1,
            },
        }),
    });
    
    if (!res.ok) throw new Error(`NovelAI: ${res.status}`);
    const data = await res.json();
    return data.output || data.image || data.images?.[0] || data;
}

function updateStatus(type, msg) {
    const el = document.getElementById('rina-status');
    if (el) {
        el.className = `rina-status ${type}`;
        el.textContent = msg;
        if (type !== 'loading') {
            setTimeout(() => { el.textContent = ''; el.className = 'rina-status'; }, 3000);
        }
    }
}

function insertImage(mesId, imageData, api) {
    const mesBlock = document.querySelector(`.mes[mesid="${mesId}"] .mes_text`);
    if (!mesBlock) return;
    
    const old = mesBlock.querySelector(`.rina-img[data-api="${api}"]`);
    if (old) old.remove();
    
    const img = document.createElement('img');
    img.className = 'rina-img';
    img.dataset.api = api;
    img.style.cssText = 'max-width:100%;max-height:512px;border-radius:8px;margin-top:10px;cursor:pointer;';
    
    if (typeof imageData === 'string') {
        if (imageData.startsWith('data:') || imageData.startsWith('http')) {
            img.src = imageData;
        } else {
            img.src = `data:image/png;base64,${imageData}`;
        }
    }
    
    img.onclick = () => window.open(img.src, '_blank');
    mesBlock.appendChild(img);
}

async function generateImage(force = false) {
    const s = getSettings();
    if (!s.enabled && !force) return;
    if (!s.useNanoBanana && !s.useNovelAI) {
        console.log('[Rina] No API selected');
        return;
    }
    
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;
    
    const lastMsg = chat[chat.length - 1];
    if (!lastMsg || lastMsg.is_user) return;
    
    const mesId = chat.length - 1;
    
    const promptCtx = {
        charDesc: context.characters?.[context.characterId]?.description || '',
        userDesc: context.persona?.description || '',
        messages: chat,
        lastMsg: lastMsg.mes,
    };
    
    const prompt = buildPrompt(promptCtx);
    const negative = s.negativePrompt;
    
    console.log('[Rina] Prompt:', prompt);
    updateStatus('loading', 'Generating...');
    
    const results = [];
    
    if (s.useNanoBanana && s.nanoBananaUrl) {
        try {
            const img = await generateViaNanoBanana(prompt, negative);
            results.push({ api: 'nanobanana', img });
        } catch (e) {
            console.error('[Rina] NanoBanana error:', e);
        }
    }
    
    if (s.useNovelAI && s.novelAIUrl) {
        try {
            const img = await generateViaNovelAI(prompt, negative);
            results.push({ api: 'novelai', img });
        } catch (e) {
            console.error('[Rina] NovelAI error:', e);
        }
    }
    
    if (results.length === 0) {
        updateStatus('error', 'Generation failed');
        return;
    }
    
    for (const r of results) {
        insertImage(mesId, r.img, r.api);
    }
    
    updateStatus('success', `Generated ${results.length} image(s)`);
}

function onSettingChange(id, key, isCheckbox = false) {
    const el = document.getElementById(id);
    if (!el) return;
    
    el.addEventListener(isCheckbox ? 'change' : 'input', function() {
        const s = getSettings();
        s[key] = isCheckbox ? this.checked : (this.type === 'number' ? parseFloat(this.value) : this.value);
        saveSettingsDebounced();
        
        if (id === 'rina-use-nanobanana') {
            document.getElementById('rina-nanobanana-url-row').style.display = this.checked ? 'flex' : 'none';
        }
        if (id === 'rina-use-novelai') {
            document.getElementById('rina-novelai-url-row').style.display = this.checked ? 'flex' : 'none';
        }
    });
}

jQuery(async () => {
    loadSettings();
    const s = getSettings();
    
    const settingsHtml = `
    <div id="rina-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎨 Rina Image Generator</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="rina-block">
                    <label class="checkbox_label">
                        <input type="checkbox" id="rina-enabled" ${s.enabled ? 'checked' : ''}>
                        <span>Enable auto-generation</span>
                    </label>
                </div>
                
                <hr>
                <h4>API Selection</h4>
                
                <div class="rina-block">
                    <label class="checkbox_label">
                        <input type="checkbox" id="rina-use-nanobanana" ${s.useNanoBanana ? 'checked' : ''}>
                        <span>Nano Banana</span>
                    </label>
                    <div id="rina-nanobanana-url-row" class="rina-row" style="display:${s.useNanoBanana ? 'flex' : 'none'}">
                        <input type="text" id="rina-nanobanana-url" class="text_pole" value="${s.nanoBananaUrl}" placeholder="https://proxy/nano-banana/KEY">
                    </div>
                </div>
                
                <div class="rina-block">
                    <label class="checkbox_label">
                        <input type="checkbox" id="rina-use-novelai" ${s.useNovelAI ? 'checked' : ''}>
                        <span>NovelAI</span>
                    </label>
                    <div id="rina-novelai-url-row" class="rina-row" style="display:${s.useNovelAI ? 'flex' : 'none'}">
                        <input type="text" id="rina-novelai-url" class="text_pole" value="${s.novelAIUrl}" placeholder="https://aituned.xyz/v1/novelai/KEY">
                    </div>
                </div>
                
                <hr>
                <h4>Prompts</h4>
                
                <div class="rina-row">
                    <span>Positive:</span>
                    <textarea id="rina-positive-prompt" class="text_pole" rows="2" placeholder="masterpiece, best quality...">${s.positivePrompt}</textarea>
                </div>
                
                <div class="rina-row">
                    <span>Negative:</span>
                    <textarea id="rina-negative-prompt" class="text_pole" rows="2" placeholder="low quality...">${s.negativePrompt}</textarea>
                </div>
                
                <div class="rina-row">
                    <span>Style (fixed):</span>
                    <input type="text" id="rina-style-prompt" class="text_pole" value="${s.stylePrompt}" placeholder="anime style...">
                </div>
                
                <hr>
                <h4>Auto-Extract</h4>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="rina-extract-char" ${s.extractCharacterAppearance ? 'checked' : ''}>
                    <span>Character appearance from card</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="rina-extract-user" ${s.extractUserAppearance ? 'checked' : ''}>
                    <span>User/Persona appearance</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="rina-extract-clothing" ${s.extractClothingFromChat ? 'checked' : ''}>
                    <span>Clothing from chat</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="rina-extract-scene" ${s.extractSceneContext ? 'checked' : ''}>
                    <span>Scene context</span>
                </label>
                
                <hr>
                <h4>Settings</h4>
                
                <div class="rina-row">
                    <span>Width:</span>
                    <input type="number" id="rina-width" class="text_pole" value="${s.width}" min="256" max="1024" step="64">
                </div>
                
                <div class="rina-row">
                    <span>Height:</span>
                    <input type="number" id="rina-height" class="text_pole" value="${s.height}" min="256" max="1024" step="64">
                </div>
                
                <div class="rina-row">
                    <span>Steps:</span>
                    <input type="number" id="rina-steps" class="text_pole" value="${s.steps}" min="1" max="50">
                </div>
                
                <div class="rina-row">
                    <span>CFG Scale:</span>
                    <input type="number" id="rina-scale" class="text_pole" value="${s.scale}" min="1" max="30" step="0.5">
                </div>
                
                <hr>
                
                <div class="rina-row">
                    <input id="rina-generate-btn" class="menu_button" type="button" value="🎨 Generate Now">
                </div>
                
                <div id="rina-status" class="rina-status"></div>
            </div>
        </div>
    </div>`;
    
    $('#extensions_settings2').append(settingsHtml);
    
    // Кнопка регенерации в wand menu
    const regenBtn = `<div id="rina-regen-btn" class="list-group-item flex-container flexGap5" title="Regenerate Rina Image">
        <i class="fa-solid fa-image extensionsMenuExtensionButton"></i>
    </div>`;
    $('#extensionsMenu').append(regenBtn);
    
    // Привязка событий
    onSettingChange('rina-enabled', 'enabled', true);
    onSettingChange('rina-use-nanobanana', 'useNanoBanana', true);
    onSettingChange('rina-use-novelai', 'useNovelAI', true);
    onSettingChange('rina-nanobanana-url', 'nanoBananaUrl');
    onSettingChange('rina-novelai-url', 'novelAIUrl');
    onSettingChange('rina-positive-prompt', 'positivePrompt');
    onSettingChange('rina-negative-prompt', 'negativePrompt');
    onSettingChange('rina-style-prompt', 'stylePrompt');
    onSettingChange('rina-extract-char', 'extractCharacterAppearance', true);
    onSettingChange('rina-extract-user', 'extractUserAppearance', true);
    onSettingChange('rina-extract-clothing', 'extractClothingFromChat', true);
    onSettingChange('rina-extract-scene', 'extractSceneContext', true);
    onSettingChange('rina-width', 'width');
    onSettingChange('rina-height', 'height');
    onSettingChange('rina-steps', 'steps');
    onSettingChange('rina-scale', 'scale');
    
    $('#rina-generate-btn').on('click', () => generateImage(true));
    $('#rina-regen-btn').on('click', () => generateImage(true));
    
    // Автогенерация при новом сообщении
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        setTimeout(() => generateImage(false), 500);
    });
    
    console.log('[Rina] Extension loaded');
});
