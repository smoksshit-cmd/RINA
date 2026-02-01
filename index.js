// Rina Image Generator Extension for SillyTavern
// Author: smoksshit-cmd

import { getContext, extension_settings, saveSettingsDebounced } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

const extensionName = 'rina-image-gen';

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
    novelAIModel: 'nai-diffusion-3',
    width: 512,
    height: 768,
    steps: 28,
    scale: 5,
    sampler: 'k_euler',
};

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.keys(defaultSettings).forEach(key => {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    });
}

function getSettings() {
    return extension_settings[extensionName];
}

function saveExtensionSettings() {
    saveSettingsDebounced();
}

function extractAppearanceFromCard(description) {
    if (!description) return '';
    
    const appearancePatterns = [
        /appearance[:\s]*([^]*?)(?=personality|background|scenario|$)/i,
        /looks?[:\s]*([^]*?)(?=personality|background|scenario|$)/i,
        /physical[:\s]*([^]*?)(?=personality|background|scenario|$)/i,
        /внешность[:\s]*([^]*?)(?=характер|история|сценарий|$)/i,
    ];
    
    for (const pattern of appearancePatterns) {
        const match = description.match(pattern);
        if (match && match[1]) {
            return match[1].trim().substring(0, 500);
        }
    }
    
    return description.substring(0, 300);
}

function extractClothingFromMessages(messages, characterName) {
    const clothingKeywords = [
        'wearing', 'dressed in', 'clothes', 'outfit', 'shirt', 'pants', 'dress',
        'jacket', 'coat', 'skirt', 'jeans', 'uniform', 'suit', 'blouse',
        'одет', 'наряд', 'платье', 'костюм', 'рубашк', 'брюк', 'юбк'
    ];
    
    const recentMessages = messages.slice(-10);
    let clothingDescriptions = [];
    
    for (const msg of recentMessages) {
        const text = msg.mes || '';
        for (const keyword of clothingKeywords) {
            if (text.toLowerCase().includes(keyword)) {
                const sentences = text.split(/[.!?]/);
                for (const sentence of sentences) {
                    if (sentence.toLowerCase().includes(keyword)) {
                        clothingDescriptions.push(sentence.trim());
                    }
                }
            }
        }
    }
    
    return clothingDescriptions.slice(0, 3).join(', ');
}

function extractSceneContext(message) {
    if (!message) return '';
    
    const withoutDialogues = message.replace(/"[^"]*"/g, '').replace(/«[^»]*»/g, '');
    
    const actionPatterns = [
        /\*([^*]+)\*/g,
        /\[([^\]]+)\]/g,
    ];
    
    let sceneElements = [];
    for (const pattern of actionPatterns) {
        const matches = withoutDialogues.matchAll(pattern);
        for (const match of matches) {
            sceneElements.push(match[1].trim());
        }
    }
    
    return sceneElements.slice(0, 5).join(', ') || withoutDialogues.substring(0, 200);
}

function buildPrompt(context) {
    const settings = getSettings();
    const parts = [];
    
    if (settings.positivePrompt) {
        parts.push(settings.positivePrompt);
    }
    if (settings.stylePrompt) {
        parts.push(`[STYLE: ${settings.stylePrompt}]`);
    }
    
    if (settings.extractCharacterAppearance && context.characterDescription) {
        const appearance = extractAppearanceFromCard(context.characterDescription);
        if (appearance) {
            parts.push(`[Character Reference: ${appearance}]`);
        }
    }
    
    if (settings.extractUserAppearance && context.userDescription) {
        const userAppearance = extractAppearanceFromCard(context.userDescription);
        if (userAppearance) {
            parts.push(`[User Reference: ${userAppearance}]`);
        }
    }
    
    if (settings.extractClothingFromChat && context.messages) {
        const clothing = extractClothingFromMessages(context.messages, context.characterName);
        if (clothing) {
            parts.push(`[Current Clothing: ${clothing}]`);
        }
    }
    
    if (settings.extractSceneContext && context.lastMessage) {
        const scene = extractSceneContext(context.lastMessage);
        if (scene) {
            parts.push(`[Scene: ${scene}]`);
        }
    }
    
    return parts.join(', ');
}

async function generateViaNanoBanana(prompt, negativePrompt) {
    const settings = getSettings();
    const url = settings.nanoBananaUrl;
    
    if (!url) {
        throw new Error('Nano Banana URL not configured');
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt: prompt,
            negative_prompt: negativePrompt || settings.negativePrompt,
            width: settings.width,
            height: settings.height,
            steps: settings.steps,
            cfg_scale: settings.scale,
            sampler_name: settings.sampler,
        }),
    });
    
    if (!response.ok) {
        throw new Error(`Nano Banana error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.image || data.images?.[0] || data;
}

async function generateViaNovelAI(prompt, negativePrompt) {
    const settings = getSettings();
    const url = settings.novelAIUrl;
    
    if (!url) {
        throw new Error('NovelAI URL not configured');
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            input: prompt,
            model: settings.novelAIModel,
            parameters: {
                width: settings.width,
                height: settings.height,
                steps: settings.steps,
                scale: settings.scale,
                sampler: settings.sampler,
                negative_prompt: negativePrompt || settings.negativePrompt,
                n_samples: 1,
            },
        }),
    });
    
    if (!response.ok) {
        throw new Error(`NovelAI error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.output || data.image || data.images?.[0] || data;
}

async function generateImage(forceRegenerate = false) {
    const settings = getSettings();
    
    if (!settings.enabled && !forceRegenerate) {
        return;
    }
    
    if (!settings.useNanoBanana && !settings.useNovelAI) {
        console.log('[Rina] No API selected');
        return;
    }
    
    const context = getContext();
    if (!context.chat || context.chat.length === 0) {
        return;
    }
    
    const lastMessage = context.chat[context.chat.length - 1];
    if (!lastMessage || lastMessage.is_user) {
        return;
    }
    
    const promptContext = {
        characterName: context.name2,
        characterDescription: context.characters?.[context.characterId]?.description || '',
        userDescription: context.persona?.description || '',
        messages: context.chat,
        lastMessage: lastMessage.mes,
    };
    
    const prompt = buildPrompt(promptContext);
    const negativePrompt = settings.negativePrompt;
    
    console.log('[Rina] Generated prompt:', prompt);
    
    updateStatus('loading', 'Generating image...');
    
    const results = [];
    
    try {
        if (settings.useNanoBanana && settings.nanoBananaUrl) {
            try {
                const result = await generateViaNanoBanana(prompt, negativePrompt);
                results.push({ api: 'nano-banana', image: result });
            } catch (e) {
                console.error('[Rina] Nano Banana error:', e);
            }
        }
        
        if (settings.useNovelAI && settings.novelAIUrl) {
            try {
                const result = await generateViaNovelAI(prompt, negativePrompt);
                results.push({ api: 'novelai', image: result });
            } catch (e) {
                console.error('[Rina] NovelAI error:', e);
            }
        }
        
        if (results.length === 0) {
            throw new Error('All API calls failed');
        }
        
        for (const result of results) {
            insertImageToMessage(lastMessage, result.image, result.api);
        }
        
        updateStatus('success', `Generated ${results.length} image(s)`);
        
    } catch (error) {
        console.error('[Rina] Generation error:', error);
        updateStatus('error', error.message);
    }
}

function insertImageToMessage(message, imageData, apiName) {
    const messageIndex = message.index !== undefined ? message.index : (getContext().chat.length - 1);
    const messageElement = document.querySelector(`[mesid="${messageIndex}"] .mes_text`);
    if (!messageElement) {
        console.log('[Rina] Message element not found for index:', messageIndex);
        return;
    }
    
    const container = document.createElement('div');
    container.className = 'rina-image-container';
    container.dataset.api = apiName;
    
    const img = document.createElement('img');
    img.className = 'rina-generated-image';
    
    if (typeof imageData === 'string') {
        if (imageData.startsWith('data:')) {
            img.src = imageData;
        } else if (imageData.startsWith('http')) {
            img.src = imageData;
        } else {
            img.src = `data:image/png;base64,${imageData}`;
        }
    }
    
    const actions = document.createElement('div');
    actions.className = 'rina-image-actions';
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'rina-image-action-btn';
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = () => downloadImage(img.src);
    
    const regenerateBtn = document.createElement('button');
    regenerateBtn.className = 'rina-image-action-btn';
    regenerateBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    regenerateBtn.title = 'Regenerate';
    regenerateBtn.onclick = () => generateImage(true);
    
    actions.appendChild(downloadBtn);
    actions.appendChild(regenerateBtn);
    
    container.appendChild(img);
    container.appendChild(actions);
    
    const oldContainer = messageElement.querySelector(`.rina-image-container[data-api="${apiName}"]`);
    if (oldContainer) {
        oldContainer.remove();
    }
    
    messageElement.appendChild(container);
}

function downloadImage(src) {
    const link = document.createElement('a');
    link.href = src;
    link.download = `rina-${Date.now()}.png`;
    link.click();
}

function updateStatus(status, message) {
    const statusElement = document.getElementById('rina-status');
    if (statusElement) {
        statusElement.className = `rina-status ${status}`;
        statusElement.textContent = message;
        
        if (status !== 'loading') {
            setTimeout(() => {
                statusElement.textContent = '';
                statusElement.className = 'rina-status';
            }, 3000);
        }
    }
}

function createUI() {
    const settings = getSettings();
    
    const html = `
    <div id="rina-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎨 Rina Image Generator</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="rina-section">
                    <div class="rina-checkbox-row">
                        <input type="checkbox" id="rina-enabled" ${settings.enabled ? 'checked' : ''}>
                        <label for="rina-enabled">Enable auto-generation</label>
                    </div>
                </div>
                
                <div class="rina-section">
                    <div class="rina-section-title">API Selection</div>
                    
                    <div class="rina-api-selector">
                        <div class="rina-api-option ${settings.useNanoBanana ? 'active' : ''}">
                            <input type="checkbox" id="rina-use-nanobanana" ${settings.useNanoBanana ? 'checked' : ''}>
                            <label for="rina-use-nanobanana">Nano Banana</label>
                        </div>
                        <div class="rina-row" id="rina-nanobanana-url-row" style="display: ${settings.useNanoBanana ? 'flex' : 'none'}">
                            <label>URL:</label>
                            <input type="text" id="rina-nanobanana-url" value="${settings.nanoBananaUrl}" placeholder="https://proxy/nano-banana/KEY">
                        </div>
                        
                        <div class="rina-api-option ${settings.useNovelAI ? 'active' : ''}">
                            <input type="checkbox" id="rina-use-novelai" ${settings.useNovelAI ? 'checked' : ''}>
                            <label for="rina-use-novelai">NovelAI</label>
                        </div>
                        <div class="rina-row" id="rina-novelai-url-row" style="display: ${settings.useNovelAI ? 'flex' : 'none'}">
                            <label>URL:</label>
                            <input type="text" id="rina-novelai-url" value="${settings.novelAIUrl}" placeholder="https://aituned.xyz/v1/novelai/KEY">
                        </div>
                    </div>
                </div>
                
                <div class="rina-section">
                    <div class="rina-section-title">Prompts</div>
                    
                    <div class="rina-row">
                        <label>Positive:</label>
                        <textarea id="rina-positive-prompt" placeholder="masterpiece, best quality...">${settings.positivePrompt}</textarea>
                    </div>
                    
                    <div class="rina-row">
                        <label>Negative:</label>
                        <textarea id="rina-negative-prompt" placeholder="low quality, bad anatomy...">${settings.negativePrompt}</textarea>
                    </div>
                    
                    <div class="rina-row">
                        <label>Style:</label>
                        <input type="text" id="rina-style-prompt" value="${settings.stylePrompt}" placeholder="anime style...">
                    </div>
                </div>
                
                <div class="rina-section">
                    <div class="rina-section-title">Auto-Extract</div>
                    
                    <div class="rina-checkbox-row">
                        <input type="checkbox" id="rina-extract-char" ${settings.extractCharacterAppearance ? 'checked' : ''}>
                        <label for="rina-extract-char">Character appearance from card</label>
                    </div>
                    
                    <div class="rina-checkbox-row">
                        <input type="checkbox" id="rina-extract-user" ${settings.extractUserAppearance ? 'checked' : ''}>
                        <label for="rina-extract-user">User/Persona appearance</label>
                    </div>
                    
                    <div class="rina-checkbox-row">
                        <input type="checkbox" id="rina-extract-clothing" ${settings.extractClothingFromChat ? 'checked' : ''}>
                        <label for="rina-extract-clothing">Clothing from chat</label>
                    </div>
                    
                    <div class="rina-checkbox-row">
                        <input type="checkbox" id="rina-extract-scene" ${settings.extractSceneContext ? 'checked' : ''}>
                        <label for="rina-extract-scene">Scene context</label>
                    </div>
                </div>
                
                <div class="rina-section">
                    <div class="rina-section-title">Generation Settings</div>
                    
                    <div class="rina-row">
                        <label>Width:</label>
                        <input type="number" id="rina-width" value="${settings.width}" min="256" max="1024" step="64">
                    </div>
                    
                    <div class="rina-row">
                        <label>Height:</label>
                        <input type="number" id="rina-height" value="${settings.height}" min="256" max="1024" step="64">
                    </div>
                    
                    <div class="rina-row">
                        <label>Steps:</label>
                        <input type="number" id="rina-steps" value="${settings.steps}" min="1" max="50">
                    </div>
                    
                    <div class="rina-row">
                        <label>CFG Scale:</label>
                        <input type="number" id="rina-scale" value="${settings.scale}" min="1" max="30" step="0.5">
                    </div>
                </div>
                
                <div class="rina-section">
                    <button id="rina-generate-now" class="menu_button" style="width: 100%;">
                        <i class="fa-solid fa-image"></i> Generate Now
                    </button>
                </div>
                
                <div id="rina-status" class="rina-status"></div>
            </div>
        </div>
    </div>
    `;
    
    $('#extensions_settings2').append(html);
    
    // Кнопка в extensionsMenu
    const regenBtn = $('<div id="rina-regen-btn" class="list-group-item flex-container flexGap5" title="Regenerate Image"><i class="fa-solid fa-image"></i></div>');
    $('#extensionsMenu').append(regenBtn);
    
    bindEvents();
}

function bindEvents() {
    const settings = getSettings();
    
    $('#rina-enabled').on('change', function() {
        settings.enabled = this.checked;
        saveExtensionSettings();
    });
    
    $('#rina-use-nanobanana').on('change', function() {
        settings.useNanoBanana = this.checked;
        $(this).closest('.rina-api-option').toggleClass('active', this.checked);
        $('#rina-nanobanana-url-row').toggle(this.checked);
        saveExtensionSettings();
    });
    
    $('#rina-use-novelai').on('change', function() {
        settings.useNovelAI = this.checked;
        $(this).closest('.rina-api-option').toggleClass('active', this.checked);
        $('#rina-novelai-url-row').toggle(this.checked);
        saveExtensionSettings();
    });
    
    $('#rina-nanobanana-url').on('input', function() {
        settings.nanoBananaUrl = this.value;
        saveExtensionSettings();
    });
    
    $('#rina-novelai-url').on('input', function() {
        settings.novelAIUrl = this.value;
        saveExtensionSettings();
    });
    
    $('#rina-positive-prompt').on('input', function() {
        settings.positivePrompt = this.value;
        saveExtensionSettings();
    });
    
    $('#rina-negative-prompt').on('input', function() {
        settings.negativePrompt = this.value;
        saveExtensionSettings();
    });
    
    $('#rina-style-prompt').on('input', function() {
        settings.stylePrompt = this.value;
        saveExtensionSettings();
    });
    
    $('#rina-extract-char').on('change', function() {
        settings.extractCharacterAppearance = this.checked;
        saveExtensionSettings();
    });
    
    $('#rina-extract-user').on('change', function() {
        settings.extractUserAppearance = this.checked;
        saveExtensionSettings();
    });
    
    $('#rina-extract-clothing').on('change', function() {
        settings.extractClothingFromChat = this.checked;
        saveExtensionSettings();
    });
    
    $('#rina-extract-scene').on('change', function() {
        settings.extractSceneContext = this.checked;
        saveExtensionSettings();
    });
    
    $('#rina-width').on('change', function() {
        settings.width = parseInt(this.value);
        saveExtensionSettings();
    });
    
    $('#rina-height').on('change', function() {
        settings.height = parseInt(this.value);
        saveExtensionSettings();
    });
    
    $('#rina-steps').on('change', function() {
        settings.steps = parseInt(this.value);
        saveExtensionSettings();
    });
    
    $('#rina-scale').on('change', function() {
        settings.scale = parseFloat(this.value);
        saveExtensionSettings();
    });
    
    $('#rina-generate-now').on('click', () => generateImage(true));
    $('#rina-regen-btn').on('click', () => generateImage(true));
}

jQuery(async () => {
    loadSettings();
    createUI();
    
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        setTimeout(() => generateImage(false), 500);
    });
    
    console.log('[Rina] Extension loaded');
});
