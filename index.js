// Rina Image Generator Extension for SillyTavern
// Author: smoksshit-cmd

import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, saveChatDebounced } from '../../../../script.js';

const extensionName = 'rina-image-gen';

const defaultSettings = {
    enabled: true,
    useNanoBanana: false,
    useNovelAI: true,
    nanoBananaUrl: '',
    novelAIKey: '',
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

// Извлечение внешности из карточки
function extractAppearanceFromCard(description) {
    if (!description) return '';
    
    const patterns = [
        /appearance[:\s]*([^]*?)(?=personality|background|scenario|###|$)/i,
        /looks?[:\s]*([^]*?)(?=personality|background|scenario|###|$)/i,
        /physical[:\s]*([^]*?)(?=personality|background|scenario|###|$)/i,
        /внешность[:\s]*([^]*?)(?=характер|история|сценарий|###|$)/i,
        /description[:\s]*([^]*?)(?=personality|background|scenario|###|$)/i,
    ];
    
    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match?.[1]) {
            return match[1].trim().substring(0, 400);
        }
    }
    return description.substring(0, 300);
}

// Извлечение одежды из сообщений
function extractClothingFromMessages(messages) {
    const keywords = [
        'wearing', 'dressed', 'clothes', 'outfit', 'shirt', 'pants', 'dress',
        'jacket', 'coat', 'skirt', 'jeans', 'uniform', 'suit', 'blouse', 'naked',
        'nude', 'underwear', 'bikini', 'swimsuit', 'armor', 'robe', 'cloak',
        'одет', 'наряд', 'платье', 'костюм', 'рубашк', 'брюк', 'юбк', 'голы', 'белье'
    ];
    
    const recent = messages.slice(-5);
    const found = [];
    
    for (const msg of recent) {
        const text = (msg.mes || '').toLowerCase();
        for (const kw of keywords) {
            if (text.includes(kw)) {
                const sentences = text.split(/[.!?\n]/);
                for (const s of sentences) {
                    if (s.includes(kw) && s.trim().length > 10) {
                        found.push(s.trim());
                    }
                }
            }
        }
    }
    return found.slice(0, 2).join(', ');
}

// УЛУЧШЕННОЕ извлечение сцены и действий из сообщения
function extractSceneFromMessage(message) {
    if (!message) return '';
    
    const sceneElements = [];
    
    // 1. Извлекаем ВСЕ действия в звёздочках *действие*
    const asteriskActions = message.match(/\*([^*]+)\*/g);
    if (asteriskActions) {
        for (const action of asteriskActions) {
            const clean = action.replace(/\*/g, '').trim();
            if (clean.length > 5) {
                sceneElements.push(clean);
            }
        }
    }
    
    // 2. Извлекаем описания в квадратных скобках [описание]
    const bracketDesc = message.match(/\[([^\]]+)\]/g);
    if (bracketDesc) {
        for (const desc of bracketDesc) {
            const clean = desc.replace(/[\[\]]/g, '').trim();
            if (clean.length > 5) {
                sceneElements.push(clean);
            }
        }
    }
    
    // 3. Ищем ключевые слова локаций и действий
    const locationKeywords = [
        // Локации
        'балкон', 'balcony', 'комната', 'room', 'bedroom', 'спальня', 'кухня', 'kitchen',
        'улица', 'street', 'парк', 'park', 'лес', 'forest', 'пляж', 'beach', 'офис', 'office',
        'школа', 'school', 'кафе', 'cafe', 'ресторан', 'restaurant', 'бар', 'bar', 'клуб', 'club',
        'ванная', 'bathroom', 'душ', 'shower', 'кровать', 'bed', 'диван', 'sofa', 'couch',
        'машина', 'car', 'поезд', 'train', 'самолет', 'plane', 'корабль', 'ship',
        // Действия
        'стоя', 'standing', 'сидя', 'sitting', 'лежа', 'lying', 'бежа', 'running',
        'идя', 'walking', 'обнима', 'hugging', 'embrace', 'целу', 'kissing', 'kiss',
        'смотр', 'looking', 'watching', 'держ', 'holding', 'танцу', 'dancing',
        // Время и атмосфера
        'ночь', 'night', 'день', 'day', 'утро', 'morning', 'вечер', 'evening',
        'закат', 'sunset', 'рассвет', 'sunrise', 'дождь', 'rain', 'снег', 'snow'
    ];
    
    const messageLower = message.toLowerCase();
    const foundKeywords = [];
    
    for (const kw of locationKeywords) {
        if (messageLower.includes(kw)) {
            // Находим предложение с этим словом
            const sentences = message.split(/[.!?\n]/);
            for (const s of sentences) {
                if (s.toLowerCase().includes(kw) && s.trim().length > 10) {
                    foundKeywords.push(s.trim());
                    break;
                }
            }
        }
    }
    
    // 4. Если ничего не нашли в специальных тегах, берём первые описательные предложения
    if (sceneElements.length === 0 && foundKeywords.length === 0) {
        // Убираем диалоги
        const withoutDialogs = message
            .replace(/"[^"]*"/g, '')
            .replace(/«[^»]*»/g, '')
            .replace(/„[^"]*"/g, '')
            .replace(/'[^']*'/g, '');
        
        const sentences = withoutDialogs.split(/[.!?\n]/).filter(s => s.trim().length > 15);
        if (sentences.length > 0) {
            // Берём первые 2-3 предложения как описание сцены
            sceneElements.push(...sentences.slice(0, 3).map(s => s.trim()));
        }
    }
    
    // Комбинируем результаты
    const allElements = [...sceneElements, ...foundKeywords];
    const uniqueElements = [...new Set(allElements)];
    
    return uniqueElements.slice(0, 5).join(', ');
}

// Конвертирует текст в URL формат
function toUrlFormat(text) {
    return encodeURIComponent(
        text
            .replace(/\s+/g, '_')
            .replace(/,\s*/g, ',_')
            .replace(/_+/g, '_')
    );
}

// Построение финального промпта
function buildPrompt(ctx) {
    const s = getSettings();
    const parts = [];
    
    // 1. Базовый стиль (всегда первый)
    if (s.positivePrompt) parts.push(s.positivePrompt);
    if (s.stylePrompt) parts.push(s.stylePrompt);
    
    // 2. СЦЕНА И ДЕЙСТВИЕ (важно! идёт рано в промпте)
    if (s.extractSceneContext && ctx.lastMsg) {
        const scene = extractSceneFromMessage(ctx.lastMsg);
        if (scene) {
            parts.push(scene);
            console.log('[Rina] Scene extracted:', scene);
        }
    }
    
    // 3. Внешность персонажа
    if (s.extractCharacterAppearance && ctx.charDesc) {
        const app = extractAppearanceFromCard(ctx.charDesc);
        if (app) parts.push(app);
    }
    
    // 4. Внешность юзера (если участвует в сцене)
    if (s.extractUserAppearance && ctx.userDesc) {
        const app = extractAppearanceFromCard(ctx.userDesc);
        if (app) parts.push(app);
    }
    
    // 5. Одежда из чата
    if (s.extractClothingFromChat && ctx.messages) {
        const cloth = extractClothingFromMessages(ctx.messages);
        if (cloth) parts.push(cloth);
    }
    
    return parts.join(', ');
}

// Генерация через NovelAI
async function generateViaNovelAI(prompt, negative) {
    const s = getSettings();
    if (!s.novelAIKey) throw new Error('NovelAI key not set');
    
    const positiveFormatted = toUrlFormat(prompt);
    const negativeFormatted = toUrlFormat(negative);
    
    const url = `https://aituned.xyz/v1/novelai/${s.novelAIKey}/prompt/${positiveFormatted}?uc=${negativeFormatted}&width=${s.width}&height=${s.height}`;
    
    console.log('[Rina] Request URL length:', url.length);
    
    const res = await fetch(url);
    
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`NovelAI error ${res.status}: ${text}`);
    }
    
    const blob = await res.blob();
    
    // Конвертируем в base64 для сохранения
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Генерация через Nano Banana
async function generateViaNanoBanana(prompt, negative) {
    const s = getSettings();
    if (!s.nanoBananaUrl) throw new Error('Nano Banana URL not set');
    
    const positiveFormatted = toUrlFormat(prompt);
    const negativeFormatted = toUrlFormat(negative);
    
    let url = s.nanoBananaUrl;
    if (!url.includes('/prompt/')) {
        url = `${url}/prompt/${positiveFormatted}?uc=${negativeFormatted}&width=${s.width}&height=${s.height}`;
    }
    
    const res = await fetch(url);
    
    if (!res.ok) {
        throw new Error(`Nano Banana error: ${res.status}`);
    }
    
    const blob = await res.blob();
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function updateStatus(type, msg) {
    const el = document.getElementById('rina-status');
    if (el) {
        el.className = `rina-status ${type}`;
        el.textContent = msg;
        if (type !== 'loading') {
            setTimeout(() => { el.textContent = ''; el.className = 'rina-status'; }, 5000);
        }
    }
}

// Отображение картинки в сообщении
function displayImageInMessage(mesId, imageBase64) {
    const mesBlock = document.querySelector(`.mes[mesid="${mesId}"] .mes_text`);
    if (!mesBlock) return;
    
    // Удаляем старый контейнер если есть
    const oldContainer = mesBlock.querySelector('.rina-img-container');
    if (oldContainer) oldContainer.remove();
    
    // Создаём контейнер
    const container = document.createElement('div');
    container.className = 'rina-img-container';
    container.style.cssText = 'position:relative;display:inline-block;margin-top:10px;max-width:100%;';
    
    // Картинка
    const img = document.createElement('img');
    img.className = 'rina-img';
    img.src = imageBase64;
    img.style.cssText = 'max-width:100%;max-height:512px;border-radius:8px;cursor:pointer;display:block;';
    img.onclick = () => {
        const win = window.open();
        win.document.write(`<img src="${imageBase64}" style="max-width:100%;">`);
    };
    
    // Кнопки управления
    const controls = document.createElement('div');
    controls.className = 'rina-img-controls';
    controls.style.cssText = 'position:absolute;top:5px;right:5px;display:flex;gap:5px;';
    
    // Кнопка перегенерации
    const regenBtn = document.createElement('button');
    regenBtn.innerHTML = '🔄';
    regenBtn.title = 'Regenerate';
    regenBtn.style.cssText = 'background:rgba(0,0,0,0.7);color:white;border:none;border-radius:4px;padding:8px 10px;cursor:pointer;font-size:16px;';
    regenBtn.onclick = (e) => {
        e.stopPropagation();
        generateImageForMessage(mesId, true);
    };
    
    // Кнопка скачивания
    const downloadBtn = document.createElement('button');
    downloadBtn.innerHTML = '💾';
    downloadBtn.title = 'Download';
    downloadBtn.style.cssText = 'background:rgba(0,0,0,0.7);color:white;border:none;border-radius:4px;padding:8px 10px;cursor:pointer;font-size:16px;';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        const link = document.createElement('a');
        link.href = imageBase64;
        link.download = `rina-${Date.now()}.png`;
        link.click();
    };
    
    controls.appendChild(regenBtn);
    controls.appendChild(downloadBtn);
    
    container.appendChild(img);
    container.appendChild(controls);
    mesBlock.appendChild(container);
}

// Сохранение картинки в данные сообщения
function saveImageToMessage(mesId, imageBase64) {
    const context = getContext();
    if (context.chat && context.chat[mesId]) {
        // Сохраняем в extra данные сообщения
        if (!context.chat[mesId].extra) {
            context.chat[mesId].extra = {};
        }
        context.chat[mesId].extra.rina_image = imageBase64;
        saveChatDebounced();
        console.log('[Rina] Image saved to message', mesId);
    }
}

// Загрузка сохранённых картинок при открытии чата
function loadSavedImages() {
    const context = getContext();
    if (!context.chat) return;
    
    for (let i = 0; i < context.chat.length; i++) {
        const msg = context.chat[i];
        if (msg.extra?.rina_image) {
            displayImageInMessage(i, msg.extra.rina_image);
        }
    }
    console.log('[Rina] Loaded saved images');
}

// Генерация для конкретного сообщения
async function generateImageForMessage(mesId, force = false) {
    const s = getSettings();
    if (!s.enabled && !force) return;
    if (!s.useNanoBanana && !s.useNovelAI) {
        console.log('[Rina] No API selected');
        return;
    }
    
    const context = getContext();
    const chat = context.chat;
    if (!chat || !chat[mesId]) return;
    
    const msg = chat[mesId];
    if (msg.is_user) return;
    
    const promptCtx = {
        charDesc: context.characters?.[context.characterId]?.description || '',
        userDesc: context.persona?.description || '',
        messages: chat.slice(0, mesId + 1),
        lastMsg: msg.mes,
    };
    
    const prompt = buildPrompt(promptCtx);
    const negative = s.negativePrompt;
    
    console.log('[Rina] Full prompt:', prompt);
    updateStatus('loading', 'Generating image...');
    
    let imageBase64 = null;
    
    if (s.useNovelAI && s.novelAIKey) {
        try {
            imageBase64 = await generateViaNovelAI(prompt, negative);
        } catch (e) {
            console.error('[Rina] NovelAI error:', e);
            updateStatus('error', 'NovelAI: ' + e.message);
        }
    }
    
    if (!imageBase64 && s.useNanoBanana && s.nanoBananaUrl) {
        try {
            imageBase64 = await generateViaNanoBanana(prompt, negative);
        } catch (e) {
            console.error('[Rina] NanoBanana error:', e);
            updateStatus('error', 'NanoBanana: ' + e.message);
        }
    }
    
    if (!imageBase64) {
        updateStatus('error', 'Generation failed');
        return;
    }
    
    // Показываем и сохраняем
    displayImageInMessage(mesId, imageBase64);
    saveImageToMessage(mesId, imageBase64);
    
    updateStatus('success', 'Image generated!');
}

// Генерация для последнего сообщения
async function generateImage(force = false) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;
    
    const lastMesId = chat.length - 1;
    await generateImageForMessage(lastMesId, force);
}

// Глобальная функция
window.rinaGenerateImage = generateImage;
window.rinaRegenerateForMessage = generateImageForMessage;

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
                        <small>API Key only:</small>
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
                    <small>Extra style:</small>
                    <input type="text" id="rina-style-prompt" class="text_pole" value="${s.stylePrompt}" placeholder="anime style...">
                </div>
                
                <hr>
                <h4>Auto-Extract</h4>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="rina-extract-char" ${s.extractCharacterAppearance ? 'checked' : ''}>
                    <span>Character appearance</span>
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
                    <span>Scene & actions from message</span>
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
        setTimeout(() => generateImage(false), 1000);
    });
    
    // Загрузка сохранённых картинок при смене чата
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => loadSavedImages(), 500);
    });
    
    // Загрузка при старте если чат уже открыт
    setTimeout(() => loadSavedImages(), 1000);
    
    console.log('[Rina] Extension loaded');
});
