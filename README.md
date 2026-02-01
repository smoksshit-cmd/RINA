# Rina Image Generator

Automatic image generation extension for SillyTavern with proxy support for Nano Banana and NovelAI APIs.

## Features

- 🎨 **Automatic image generation** on every character message
- 🔗 **Dual API support** - Nano Banana and NovelAI (use one or both)
- 👤 **Auto-extract appearance** from character and persona cards
- 👗 **Clothing detection** from chat messages
- 🎬 **Scene context parsing** for accurate image prompts
- 🎯 **Fixed style prompts** to maintain consistency
- ⚡ **Quick regenerate button** in the message panel
- ⚙️ **Full customization** - prompts, size, steps, CFG scale

## Installation

### Method 1: Git Clone (Recommended)

```bash
cd SillyTavern/data/default-user/extensions
git clone https://github.com/smoksshit-cmd/rina-image-gen
```

### Method 2: Manual Download

1. Download this repository as ZIP
2. Extract to `SillyTavern/data/default-user/extensions/rina-image-gen`
3. Restart SillyTavern

## Configuration

1. Open SillyTavern
2. Go to **Extensions** panel
3. Find **🎨 Rina Image Generator**
4. Configure your settings:

### API Setup

**For Nano Banana:**
- Enable "Nano Banana" checkbox
- Enter your proxy URL: `https://your-proxy.com/nano-banana/YOUR_KEY`

**For NovelAI:**
- Enable "NovelAI" checkbox  
- Enter your proxy URL: `https://aituned.xyz/v1/novelai/YOUR_KEY`

You can enable both APIs simultaneously - images will be generated from both.

### Prompt Configuration

| Field | Description |
|-------|-------------|
| **Positive** | Base quality tags (masterpiece, best quality, etc.) |
| **Negative** | Tags to avoid (low quality, bad anatomy, etc.) |
| **Style** | Fixed style that applies to all generations |

### Auto-Extract Options

- ✅ **Character appearance** - Extracts looks from character card description
- ✅ **User/Persona appearance** - Extracts your persona's looks
- ✅ **Clothing from chat** - Detects outfit changes in messages
- ✅ **Scene context** - Parses actions and environment from messages

## How Prompts are Built

The extension builds prompts in this order:

```
1. [Positive Prompt] + [STYLE: fixed style]
2. [Character Reference: appearance from card]
3. [User Reference: persona appearance]
4. [Current Clothing: detected from chat]
5. [Scene: context from last message]
6. [AVOID: negative prompt]
```

## Usage

1. **Automatic**: Just chat! Images generate automatically for each character response
2. **Manual**: Click the 🎨 button in the quick panel to regenerate
3. **Download**: Hover over any generated image and click download

## Troubleshooting

**Images not generating:**
- Check if extension is enabled
- Verify API URL is correct
- Check browser console for errors (F12)

**Wrong appearance:**
- Make sure character card has appearance description
- Check if "Extract character appearance" is enabled

**Style not consistent:**
- Fill in the "Style" field with your preferred tags
- This will be fixed across all generations

## Credits

Created by **smoksshit-cmd**

## License

MIT License - feel free to modify and distribute.
