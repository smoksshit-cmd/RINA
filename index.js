// Rina Image Generator Extension for SillyTavern
// Author: smoksshit-cmd

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const extensionName = 'rina-image-gen';

const defaultSettings = {
    enabled: true,
    useNanoBanana: false,
    useNovelAI: true,
    nanoBananaUrl: '',
    novelAIKey: '', // Только ключ, без полного URL
    positivePrompt: '0.5::{{artist:5202609076a}}, {{artist:2400db}}, 0.8::{{artist:kamochiru}}, masterpiece, best quality, absurdres, source anime, vibrant colors',
    negativePrompt: 'worst_quality, low_quality, lowres, jpeg_artifacts, blurry, grainy, noisy, photorealistic, hyper_realistic, realistic, 3d, 3d_render, cgi, uncanny_valley, bad_anatomy, wrong_anatomy, bad_body, deformed, disfigured, mutated, mutation, ugly, disgusting, amputation, extra_limb, extra_limbs, missing_limbs, extra_arm, extra_leg, floating_limbs, disconnected_limbs, fused_limbs, twisted_limbs, bad_hands, bad_fingers, mutated_hands, malformed_hands, deformed_hands, extra_fingers, fewer_fingers, missing_fingers, fused_fingers, too_many_fingers, six_fingers, twisted_fingers, broken_fingers, merged_fingers, lobster_hands, bad_face, ugly_face, deformed_face, asymmetrical_face, asymmetrical_eyes, mismatched_eyes, crossed_eyes, bulging_eyes, melted_face, distorted_face, poorly_drawn_face, excessive_emotion, exaggerated_expression, crooked_mouth, bad_proportions, wrong_proportions, disproportionate, anatomically_incorrect, impossible_pose, contorted_pose, unnatural_pose, broken_pose, dislocated_joints, impossible_angle, bad_foreshortening, bad_feet, extra_toes, watermark, signature, text, logo',
    stylePrompt: '',
    extractCharacterAppearance: true,
    extractUserAppearance: true,
    extractClothingFromChat: true,
    extractSceneContext: true,
    width: 512,
    height: 768,
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

// Конвертирует текст в URL формат (пробелы -> подчёркивания)
function toUrlFormat(text) {
    return encodeURIComponent(text.replace(/\s+/g, '_').replace(/,_/g, ',_'));
}

function buildPrompt(ctx) {
    const s = getSettings();
    const parts = [];
    
    // Базовый стиль
    if (s.positivePrompt) parts.push(s.positivePrompt);
    if (s.stylePrompt) parts.push(s.stylePrompt);
    
    // Внешность персонажа
    if (s.extractCharacterAppearance && ctx.charDesc) {
        const app = extractAppearanceFromCard(ctx.charDesc);
        if (app) parts.push(app);
    }
    
    // Внешность юзера
    if (s.extractUserAppearance && ctx.userDesc) {
        const app = extractAppearanceFromCard(ctx.userDesc);
        if (app) parts.push(app);
    }
    
    // Одежда из чата
    if (s.extractClothingFromChat && ctx.messages) {
        const cloth = extractClothingFromMessages(ctx.messages);
        if (cloth) parts.push(cloth);
    }
    
    // Контекст сцены
    if (s.extractSceneContext && ctx.lastMsg) {
        const scene = extractSceneContext(ctx.lastMsg);
        if (scene) parts.push(scene);
    }
    
    return parts.join(', ');
}

// Генерация через NovelAI (aituned прокси) - GET запрос
async function generateViaNovelAI(prompt, negative) {
    const s = getSettings();
    if (!s.novelAIKey) throw new Error('NovelAI key not set');
    
    const positiveFormatted = toUrlFormat(prompt);
    const negativeFormatted = toUrlFormat(negative);
    
    // Формат: https://aituned.xyz/v1/novelai/KEY/prompt/POSITIVE?uc=NEGATIVE&width=X&height=Y
    const url = `https://aituned.xyz/v1/novelai/${s.novelAIKey}/prompt/${positiveFormatted}?uc=${negativeFormatted}&width=${s.width}&height=${s.height}`;
    
    console.log('[Rina] Request URL:', url);
    
    const res = await fetch(url);
    
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`NovelAI error ${res.status}: ${text}`);
    }
    
    // Ответ - это изображение напрямую
    const blob = await res.blob();
    return URL.createObjectURL(blob);
}

// Генерация через Nano Banana - тоже GET если такой же формат
async function generateViaNanoBanana(prompt, negative) {
    const s = getSettings();
    if (!s.nanoBananaUrl) throw new Error('Nano Banana URL not set');
    
    const positiveFormatted = toUrlFormat(prompt);
    const negativeFormatted = toUrlFormat(negative);
    
    // Предполагаем похожий формат
    let url = s.nanoBananaUrl;
    if (!url.includes('/prompt/')) {
        url = `${url}/prompt/${positiveFormatted}?uc=${negativeFormatted}&width=${s.width}&height=${s.height}`;
    }
    
    console.log('[Rina] Nano Banana URL:', url);
    
    const res = await fetch(url);
    
    if (!res.ok) {
        throw new Error(`Nano Banana error: ${res.status}`);
    }
    
    const blob = await res.blob();
    return URL.createObjectURL(blob);
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

function insertImage(mesId, imageUrl, api) {
    const mesBlock = document.querySelector(`.mes[mesid="${mesId}"] .mes_text`);
    if (!mesBlock) return;
    
    const old = mesBlock.querySelector(`.rina-img[data-api="${api}"]`);
    if (old) old.remove();
    
    const container = document.createElement('div');
    container.className = 'rina-img-container';
    container.dataset.api = api;
    container.style.cssText = 'position:relative;display:inline-block;margin-top:10px;';
    
    const img = document.createElement('img');
    img.className = 'rina-img';
    img.src = imageUrl;
    img.style.cssText = 'max-width:100%;max-height:512px;border-radius:8px;cursor:pointer;display:block;';
    img.onclick = () => window.open(imageUrl, '_blank');
    
    // Кнопка перегенерации на картинке
    const regenBtn = document.createElement('button');
    regenBtn.innerHTML = '🔄';
    regenBtn.title = 'Regenerate';
    regenBtn.style.cssText = 'position:absolute;top:5px;right:5px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:4px;padding:5px 8px;cursor:pointer;opacity:0;transition:opacity 0.2s;';
    regenBtn.onclick = (e) => { e.stopPropagation(); generateImage(true); };
    
    container.onmouseenter = () => regenBtn.style.opacity = '1';
    container.onmouseleave = () => regenBtn.style.opacity = '0';
    
    container.appendChild(img);
    container.appendChild(regenBtn);
    mesBlock.appendChild(container);
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
            updateStatus('error', 'NanoBanana: ' + e.message);
        }
    }
    
    if (s.useNovelAI && s.novelAIKey) {
        try {
            const img = await generateViaNovelAI(prompt, negative);
            results.push({ api: 'novelai', img });
        } catch (e) {
            console.error('[Rina] NovelAI error:', e);
            updateStatus('error', 'NovelAI: ' + e.message);
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

// Делаем функцию доступной глобально для кнопки
window.rinaGenerateImage = generateImage;

function onSettingChange(id, key, isCheckbox = false) {
    const el = document.getElementById(id);
    if (!el) return;
    
    el.addEventListener(isCheckbox ? 'change' : 'input', function() {
        const s = getSettings();
        s[key] = isCheckbox ? this.checked : (this.type === 'number' ? parseFloat(this.value) : this.value);
        saveSettingsDebounced();
        
        if (id === 'rina-use-nanobanana') {
            document.getElementById('rina-nanobanana-url-row').style.display = this.checked ? 'block' : 'none';
        }
        if (id === 'rina-use-novelai') {
            document.getElementById('rina-novelai-key-row').style.display = this.checked ? 'block' : 'none';
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
                    <div id="rina-nanobanana-url-row" style="display:${s.useNanoBanana ? 'block' : 'none'};margin-top:5px;">
                        <small>Full URL with key:</small>
                        <input type="text" id="rina-nanobanana-url" class="text_pole" value="${s.nanoBananaUrl}" placeholder="https://proxy/nano-banana/YOUR_KEY">
                    </div>
                </div>
                
                <div class="rina-block">
                    <label class="checkbox_label">
                        <input type="checkbox" id="rina-use-novelai" ${s.useNovelAI ? 'checked' : ''}>
                        <span>NovelAI (aituned)</span>
                    </label>
                    <div id="rina-novelai-key-row" style="display:${s.useNovelAI ? 'block' : 'none'};margin-top:5px;">
                        <small>API Key only (e.g. sk_aituned_xxx):</small>
                        <input type="text" id="rina-novelai-key" class="text_pole" value="${s.novelAIKey}" placeholder="sk_aituned_xxxxx">
                    </div>
                </div>
                
                <hr>
                <h4>Prompts</h4>
                
                <div class="rina-row">
                    <small>Positive (style):</small>
                    <textarea id="rina-positive-prompt" class="text_pole" rows="3">${s.positivePrompt}</textarea>
                </div>
                
                <div class="rina-row" style="margin-top:10px;">
                    <small>Negative:</small>
                    <textarea id="rina-negative-prompt" class="text_pole" rows="3">${s.negativePrompt}</textarea>
                </div>
                
                <div class="rina-row" style="margin-top:10px;">
                    <small>Extra style (optional):</small>
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
                <h4>Image Size</h4>
                
                <div style="display:flex;gap:10px;">
                    <div style="flex:1;">
                        <small>Width:</small>
                        <input type="number" id="rina-width" class="text_pole" value="${s.width}" min="256" max="1024" step="64">
                    </div>
                    <div style="flex:1;">
                        <small>Height:</small>
                        <input type="number" id="rina-height" class="text_pole" value="${s.height}" min="256" max="1024" step="64">
                    </div>
                </div>
                
                <hr>
                
                <div class="rina-row">
                    <input id="rina-generate-btn" class="menu_button" type="button" value="🎨 Generate Now" style="width:100%;">
                </div>
                
                <div id="rina-status" class="rina-status"></div>
            </div>
        </div>
    </div>`;
    
    $('#extensions_settings2').append(settingsHtml);
    
    // Кнопка в wand menu
    const regenBtn = `<div id="rina-regen-btn" class="list-group-item flex-container flexGap5" title="Regenerate Rina Image">
        <i class="fa-solid fa-image extensionsMenuExtensionButton"></i>
        <span>Rina Gen</span>
    </div>`;
    $('#extensionsMenu').append(regenBtn);
    
    // Привязка событий
    onSettingChange('rina-enabled', 'enabled', true);
    onSettingChange('rina-use-nanobanana', 'useNanoBanana', true);
    onSettingChange('rina-use-novelai', 'useNovelAI', true);
    onSettingChange('rina-nanobanana-url', 'nanoBananaUrl');
    onSettingChange('rina-novelai-key', 'novelAIKey');
    onSettingChange('rina-positive-prompt', 'positivePrompt');
    onSettingChange('rina-negative-prompt', 'negativePrompt');
    onSettingChange('rina-style-prompt', 'stylePrompt');
    onSettingChange('rina-extract-char', 'extractCharacterAppearance', true);
    onSettingChange('rina-extract-user', 'extractUserAppearance', true);
    onSettingChange('rina-extract-clothing', 'extractClothingFromChat', true);
    onSettingChange('rina-extract-scene', 'extractSceneContext', true);
    onSettingChange('rina-width', 'width');
    onSettingChange('rina-height', 'height');
    
    $('#rina-generate-btn').on('click', () => generateImage(true));
    $('#rina-regen-btn').on('click', () => generateImage(true));
    
    // Автогенерация при новом сообщении
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        setTimeout(() => generateImage(false), 500);
    });
    
    console.log('[Rina] Extension loaded');
});
