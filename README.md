# Whisper to Clipboard

A VSCode extension that adds voice-to-text functionality using OpenAI's Whisper API.

## Features

- Record voice directly from VSCode
- Transcribe speech to text using OpenAI's Whisper API
- **Copies transcribed text automatically to clipboard for easy pasting**
- Single keyboard shortcut (`Cmd+Shift+R` / `Ctrl+Shift+R`) to toggle recording
- Status bar button for easy access
- Dedicated panel for recording controls

## Usage Example

The original usecase for this extension was, to speed up the process of writing prompts into the AI Panel. The transcription feature saves you the time of typing the prompt manually. Simply paste your transcription into the AI Panel and you're good to go.

## API COST
The official Whisper API is quite cheap. Since the most prompts are short, the cost is usually below $0.01 per recording.

- Whisper API: $0.006 per minute (based on Feb 2025 pricing)

## Requirements

- Cursor Editor
- OpenAI API key (for Whisper API access)
- Microphone access
- **System audio recording tools:**
  - **macOS**: SoX (`brew install sox`)
  - **Linux**: arecord (part of ALSA utils, `sudo apt-get install alsa-utils`)
  - **Windows**: Not yet supported (coming soon)

## Installation

### System Dependencies

Before installing the extension, install the required audio recording tools:

#### macOS
```bash
brew install sox
```

#### Linux
```bash
sudo apt-get install alsa-utils
```

### Manually Installing the Extension

1. Download the `.vsix` file from the [releases page](https://github.com/GrowthWizard/whisper-to-clipboard/releases)
2. In Cursor, go to Extensions (Ctrl+Shift+X or Cmd+Shift+X)
3. Move the downloaded `.vsix` file into your extensions panel to install it.

## Usage

1. Set your OpenAI API key by running `CMD+Shift+R`for the first time. You can find your API key in the [OpenAI dashboard](https://platform.openai.com/api-keys).
2. Click the "Start Recording" button in the status bar or press `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux)
3. Speak clearly into your microphone
4. Press the same shortcut `CMD+Shift+R` again to stop recording
5. The transcribed text will be automatically copied to your clipboard
6. Paste the text anywhere using `Cmd+V` (Mac) / `Ctrl+V` (Windows/Linux)

## Where is your API Key stored?

Your API Key is stored locally in the extension's configuration file. It is not shared with anyone else.

## Voice Recording Panel

For easier access:

1. Open the panel view by clicking on the "Whisper to Clipboard" icon in the panel area
2. Use the buttons to start/stop recording or open the chat window
3. The transcribed text will be copied to your clipboard for easy pasting

## Troubleshooting

### Recording Issues
- Make sure you have installed the required system dependencies
- Check that your microphone is properly connected and has permission to be accessed

### Transcription Issues
- Verify your OpenAI API key is correct and has access to the Whisper API
- Ensure you're speaking clearly and your microphone is working properly

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Package as VSIX
npm run package

# Install the extension in Cursor
cursor --install-extension releases/whisper-to-clipboard-0.1.0.vsix

```

## License

MIT License