# Whisper to Clipboard

A VSCode extension that adds voice-to-text functionality using OpenAI's Whisper API.

## Features

- Record voice directly from VSCode
- Transcribe speech to text using OpenAI's Whisper API
- **Copies transcribed text automatically to clipboard for easy pasting**
- Single keyboard shortcut (`Cmd+Shift+R` / `Ctrl+Shift+R`) to toggle recording
- Status bar button for easy access
- Dedicated panel for recording controls
- **Configurable recording duration** (default: 2 minutes)
- **Adjustable audio quality settings** to balance transcription quality and API costs
- **Multi-language support** with automatic language detection or specific language selection
- **Smart handling of long recordings** by splitting into optimal chunks (requires FFmpeg)

## Usage Example

The original usecase for this extension was, to speed up the process of writing prompts into the AI Panel. The transcription feature saves you the time of typing the prompt manually. Simply paste your transcription into the AI Panel and you're good to go.

## API COST
The official Whisper API is quite cheap. Since the most prompts are short, the cost is usually below $0.01 per recording.

- Whisper API: $0.006 per minute (based on Feb 2025 pricing)

Note: Higher audio quality settings will result in larger file sizes, which may slightly increase API costs due to larger data transfers. The extension now offers three quality levels to help you balance quality and cost.

## Requirements

- Cursor Editor
- OpenAI API key (for Whisper API access)
- Microphone access
- **System audio recording tools:**
  - **macOS**: SoX (`brew install sox`)
  - **Linux**: arecord (part of ALSA utils, `sudo apt-get install alsa-utils`)
  - **Windows**: Not yet supported (coming soon)
- **Optional but recommended**: FFmpeg for improved handling of long recordings
  - **macOS**: `brew install ffmpeg`
  - **Linux**: `sudo apt-get install ffmpeg`

## Installation

### System Dependencies

Before installing the extension, install the required audio recording tools:

#### macOS
```bash
brew install sox
brew install ffmpeg  # Optional but recommended for long recordings
```

#### Linux
```bash
sudo apt-get install alsa-utils
sudo apt-get install ffmpeg  # Optional but recommended for long recordings
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

### Long Recordings

For recordings longer than 1 minute:
- If FFmpeg is installed, the extension will automatically split the recording into optimal chunks for better transcription accuracy
- Each chunk will be processed separately and then combined into a single coherent transcription
- This helps overcome Whisper API limitations with longer recordings

## Configuration

### Recording Duration

You can configure the maximum recording duration:

1. Via the extension panel: Click the "Set Recording Duration" button
2. Via command palette: Run the "Set Maximum Recording Duration" command
3. Via settings: Edit the `whisperToClipboard.recordingDurationSeconds` setting

The default duration is 120 seconds (2 minutes), but you can set it up to 600 seconds (10 minutes).

### Audio Quality

You can configure the audio quality to balance between transcription accuracy and API costs:

1. Via the extension panel: Click the "Set Audio Quality" button
2. Via command palette: Run the "Set Audio Recording Quality" command
3. Via settings: Edit the `whisperToClipboard.audioQuality` setting

Available quality options:
- **Economy (16kHz)**: Lower quality, smaller files, more economical for API usage
- **Standard (24kHz)**: Good balance between quality and cost (default)
- **High (44.1kHz)**: Best transcription quality but larger files

### Language Settings

You can configure how the extension handles different languages:

1. Via the extension panel: Click the "Set Language Mode" button
2. Via command palette: Run the "Set Transcription Language Mode" command
3. Via settings: Edit the `whisperToClipboard.languageMode` setting

Available language options:
- **Auto-detect language** (default): Whisper will automatically detect the language you're speaking
- **Specific language**: Force transcription in a specific language (English, German, French, etc.)

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
- If you're getting very short or incorrect transcriptions (like "youyou"), try the following:
  - Speak clearly and at a normal pace
  - Make sure there's not too much background noise
  - Try recording in a quieter environment
  - Check that your microphone is not muted or set to a very low volume
  - Try increasing the audio quality setting (may increase API costs slightly)

### Transcription Issues
- Verify your OpenAI API key is correct and has access to the Whisper API
- Ensure you're speaking clearly and your microphone is working properly
- If your recording is being cut off, try increasing the recording duration in the settings
- If you receive unusually short transcriptions, a debug audio file will be saved to your home directory for troubleshooting
- If you're concerned about API costs, try the "Economy" audio quality setting
- If you're speaking in a language other than English and getting translations instead of transcriptions, make sure to set the language mode to "Auto-detect" or select your specific language
- For long recordings (>1 minute), install FFmpeg for better handling and more accurate transcriptions

### Long Recording Issues
- If only part of your long recording is being transcribed, install FFmpeg which enables the extension to split the recording into optimal chunks
- For very long recordings, try setting a specific language instead of using auto-detect
- If you're still having issues with long recordings, try recording in shorter segments

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Package as VSIX
npm run package

# Install the extension in Cursor
cursor --install-extension whisper-to-clipboard-0.2.3.vsix

```

## License

MIT License