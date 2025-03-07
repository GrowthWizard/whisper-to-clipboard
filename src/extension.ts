// src/extension.ts
import * as vscode from 'vscode';
import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { copyToClipboard, tryOpenChatWindow } from './cursor-integration';

// Global variables
let statusBarItem: vscode.StatusBarItem;
let recordButton: vscode.StatusBarItem;
let isRecording = false;
let recordingProcess: child_process.ChildProcess | null = null;
let tempFilePath: string = '';
let apiKey: string = '';
let openai: OpenAI | null = null;
let chatButton: vscode.WebviewView | null = null;
let globalApiKey: string = '';

// Function to update the recording state context
function updateRecordingState(recording: boolean) {
    isRecording = recording;
    vscode.commands.executeCommand('setContext', 'isRecording', recording);
}

// Function to get the configured recording duration in seconds
function getRecordingDuration(): number {
    const config = vscode.workspace.getConfiguration('whisperToClipboard');
    return config.get<number>('recordingDurationSeconds', 120);
}

// Function to get the configured audio quality
function getAudioQuality(): { sampleRate: string, description: string } {
    const config = vscode.workspace.getConfiguration('whisperToClipboard');
    const quality = config.get<string>('audioQuality', 'standard');
    
    switch (quality) {
        case 'economy':
            return { sampleRate: '16000', description: 'Economy (16kHz)' };
        case 'high':
            return { sampleRate: '44100', description: 'High (44.1kHz)' };
        case 'standard':
        default:
            return { sampleRate: '24000', description: 'Standard (24kHz)' };
    }
}

// Function to get the configured language mode
function getLanguageMode(): { code: string | null, description: string } {
    const config = vscode.workspace.getConfiguration('whisperToClipboard');
    const languageMode = config.get<string>('languageMode', 'auto');
    
    if (languageMode === 'auto') {
        return { code: null, description: 'Auto-detect language' };
    }
    
    // Map language code to description
    const languageMap: Record<string, string> = {
        'en': 'English',
        'de': 'German',
        'fr': 'French',
        'es': 'Spanish',
        'it': 'Italian',
        'pt': 'Portuguese',
        'nl': 'Dutch',
        'ru': 'Russian',
        'zh': 'Chinese',
        'ja': 'Japanese',
        'ko': 'Korean'
    };
    
    return { 
        code: languageMode, 
        description: languageMap[languageMode] || languageMode 
    };
}

// Function to check if ffmpeg is installed
async function isFFmpegInstalled(): Promise<boolean> {
    try {
        await new Promise<void>((resolve, reject) => {
            const process = child_process.spawn('ffmpeg', ['-version']);
            let output = '';
            
            process.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    console.log(`FFmpeg found: ${output.split('\n')[0]}`);
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });
            
            process.on('error', (err) => {
                console.error('FFmpeg error:', err);
                reject(err);
            });
        });
        return true;
    } catch (error) {
        console.log('FFmpeg not found or not working properly:', error);
        return false;
    }
}

// Function to split audio file into chunks
async function splitAudioFile(inputFile: string, maxChunkDuration: number = 60): Promise<string[]> {
    const hasFFmpeg = await isFFmpegInstalled();
    if (!hasFFmpeg) {
        console.log('FFmpeg not installed or not working properly, skipping audio splitting');
        vscode.window.showWarningMessage('FFmpeg not found. Long recordings may not be transcribed accurately. Consider installing FFmpeg for better results.');
        return [inputFile]; // Return original file if FFmpeg is not available
    }
    
    try {
        // Get audio duration using ffprobe
        const durationOutput = await new Promise<string>((resolve, reject) => {
            const process = child_process.spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                inputFile
            ]);
            
            let output = '';
            let errorOutput = '';
            
            process.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    console.error('FFprobe error output:', errorOutput);
                    reject(new Error(`FFprobe exited with code ${code}: ${errorOutput}`));
                }
            });
            
            process.on('error', (err) => {
                console.error('FFprobe process error:', err);
                reject(err);
            });
        });
        
        const duration = parseFloat(durationOutput);
        console.log(`Audio duration: ${duration} seconds`);
        
        if (isNaN(duration)) {
            console.error('Could not determine audio duration, using original file');
            return [inputFile];
        }
        
        if (duration <= maxChunkDuration) {
            console.log(`Audio duration (${duration}s) is less than max chunk duration (${maxChunkDuration}s), no need to split`);
            return [inputFile]; // No need to split if duration is less than max chunk duration
        }
        
        // Calculate number of chunks
        const numChunks = Math.ceil(duration / maxChunkDuration);
        console.log(`Splitting audio into ${numChunks} chunks`);
        
        const chunkFiles: string[] = [];
        
        // Split audio into chunks
        for (let i = 0; i < numChunks; i++) {
            const startTime = i * maxChunkDuration;
            const chunkFile = `${inputFile}_chunk_${i}.wav`;
            chunkFiles.push(chunkFile);
            
            console.log(`Creating chunk ${i+1}/${numChunks}: ${startTime}s to ${startTime + maxChunkDuration}s`);
            
            await new Promise<void>((resolve, reject) => {
                const process = child_process.spawn('ffmpeg', [
                    '-i', inputFile,
                    '-ss', startTime.toString(),
                    '-t', maxChunkDuration.toString(),
                    '-c:a', 'pcm_s16le', // Use same codec as original
                    '-ar', '24000', // Use standard sample rate
                    '-ac', '1', // Mono
                    '-y', // Overwrite output files
                    chunkFile
                ]);
                
                let errorOutput = '';
                
                process.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                process.on('close', (code) => {
                    if (code === 0) {
                        console.log(`Successfully created chunk ${i+1}/${numChunks}`);
                        resolve();
                    } else {
                        console.error(`FFmpeg error for chunk ${i+1}:`, errorOutput);
                        reject(new Error(`FFmpeg exited with code ${code} for chunk ${i+1}: ${errorOutput}`));
                    }
                });
                
                process.on('error', (err) => {
                    console.error(`FFmpeg process error for chunk ${i+1}:`, err);
                    reject(err);
                });
            });
        }
        
        return chunkFiles;
    } catch (error) {
        console.error('Error splitting audio file:', error);
        vscode.window.showWarningMessage('Error splitting audio file. Using original file for transcription.');
        return [inputFile]; // Return original file if splitting fails
    }
}

// Function to transcribe audio file(s) and combine results
async function transcribeAudio(
    audioFiles: string[], 
    openaiClient: OpenAI, 
    languageMode: { code: string | null, description: string }
): Promise<string> {
    if (audioFiles.length === 1) {
        // Single file transcription
        console.log('Transcribing single audio file');
        
        const apiParams: any = {
            file: fs.createReadStream(audioFiles[0]),
            model: "whisper-1",
            response_format: "json",
            temperature: 0.0,
            // Use a more technical prompt that's less likely to be included in the output
            prompt: ""
        };
        
        if (languageMode.code) {
            apiParams.language = languageMode.code;
            console.log(`Using specific language for transcription: ${languageMode.description}`);
        } else {
            console.log('Using automatic language detection for transcription');
        }
        
        try {
            const transcription = await openaiClient.audio.transcriptions.create(apiParams);
            
            // Handle the response based on format
            let result = '';
            if (typeof transcription === 'string') {
                result = transcription;
            } else if (transcription && typeof transcription === 'object') {
                // Extract text from JSON response
                result = transcription.text || '';
            }
            
            // Validate the result
            if (!result || result.trim().length === 0) {
                console.warn('Received empty transcription from Whisper API');
                throw new Error('No speech detected in the recording');
            }
            
            // Check if the result is just the prompt repeated
            if (result.trim() === "This is a voice recording that may contain multiple sentences." || 
                result.trim() === "This is a voice recording that may contain multiple sentences. Transcribe exactly what was said.") {
                console.warn('Transcription appears to be just the prompt text');
                throw new Error('No actual speech detected, only received the prompt text back');
            }
            
            console.log(`Transcription successful: ${result.length} characters`);
            return result;
        } catch (error) {
            console.error('Error during single file transcription:', error);
            throw error;
        }
    } else {
        // Multiple chunks transcription
        console.log(`Transcribing ${audioFiles.length} audio chunks`);
        let combinedTranscription = '';
        
        for (let i = 0; i < audioFiles.length; i++) {
            console.log(`Processing chunk ${i+1}/${audioFiles.length}`);
            vscode.window.setStatusBarMessage(`Transcribing chunk ${i+1}/${audioFiles.length}...`, 3000);
            
            // Use the end of previous transcription as context for the next chunk
            const contextPrompt = i > 0 
                ? `Continue from: "${combinedTranscription.slice(-150)}"`
                : "";
            
            const apiParams: any = {
                file: fs.createReadStream(audioFiles[i]),
                model: "whisper-1",
                response_format: "json",
                temperature: 0.0,
                prompt: contextPrompt
            };
            
            if (languageMode.code) {
                apiParams.language = languageMode.code;
                
                // Language-specific context prompts for continuation only
                if (i > 0) {
                    if (languageMode.code === 'de') {
                        apiParams.prompt = `Setze fort von: "${combinedTranscription.slice(-150)}"`;
                    } else if (languageMode.code === 'fr') {
                        apiParams.prompt = `Continuez à partir de: "${combinedTranscription.slice(-150)}"`;
                    } else if (languageMode.code === 'es') {
                        apiParams.prompt = `Continúa desde: "${combinedTranscription.slice(-150)}"`;
                    }
                }
            }
            
            try {
                const transcription = await openaiClient.audio.transcriptions.create(apiParams);
                
                // Handle the response based on format
                let chunkText = '';
                if (typeof transcription === 'string') {
                    chunkText = transcription;
                } else if (transcription && typeof transcription === 'object') {
                    // Extract text from JSON response
                    chunkText = transcription.text || '';
                }
                
                // Check if the result is just the prompt repeated
                if (chunkText.trim() === "This is a voice recording that may contain multiple sentences." || 
                    chunkText.trim() === "This is a voice recording that may contain multiple sentences. Transcribe exactly what was said.") {
                    console.warn(`Chunk ${i+1} returned only the prompt text, skipping`);
                    continue;
                }
                
                if (!chunkText || chunkText.trim().length === 0) {
                    console.warn(`Chunk ${i+1} returned empty transcription, skipping`);
                    continue;
                }
                
                console.log(`Chunk ${i+1} transcription: ${chunkText.length} characters`);
                
                // Smart joining of chunks to avoid duplicate text or broken sentences
                if (i > 0) {
                    // Check for overlap with previous chunk
                    const lastWords = combinedTranscription.split(' ').slice(-5).join(' ').toLowerCase();
                    const firstWords = chunkText.split(' ').slice(0, 5).join(' ').toLowerCase();
                    
                    if (lastWords.includes(firstWords) || firstWords.includes(lastWords)) {
                        // There's overlap, find a good joining point
                        const overlapIndex = chunkText.toLowerCase().indexOf(lastWords);
                        if (overlapIndex > 0) {
                            combinedTranscription += ' ' + chunkText.substring(overlapIndex + lastWords.length);
                        } else {
                            combinedTranscription += ' ' + chunkText;
                        }
                    } else {
                        // No obvious overlap, just join with space if needed
                        combinedTranscription += (combinedTranscription.endsWith('.') || chunkText.startsWith('.') || 
                                                combinedTranscription.endsWith('!') || chunkText.startsWith('!') ||
                                                combinedTranscription.endsWith('?') || chunkText.startsWith('?') ||
                                                combinedTranscription.endsWith(',') || chunkText.startsWith(','))
                            ? ' ' + chunkText
                            : '. ' + chunkText;
                    }
                } else {
                    // First chunk
                    combinedTranscription = chunkText;
                }
            } catch (error) {
                console.error(`Error transcribing chunk ${i+1}:`, error);
                vscode.window.showWarningMessage(`Error with chunk ${i+1}. Continuing with partial transcription.`);
                // Continue with other chunks despite error
            }
        }
        
        if (!combinedTranscription || combinedTranscription.trim().length === 0) {
            throw new Error('Failed to transcribe any audio content from the chunks');
        }
        
        console.log(`Combined transcription complete: ${combinedTranscription.length} characters`);
        return combinedTranscription;
    }
}

// Helper function to get API key with validation
async function getApiKey(showValidationMessage: boolean = true): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('whisperToClipboard');
    let apiKey = config.get<string>('openaiApiKey', '');
    
    // If API key is not set in settings, try the global variable
    if (!apiKey && globalApiKey) {
        apiKey = globalApiKey;
        
        // Save the global variable to settings for future use
        await config.update('openaiApiKey', apiKey, true);
        console.log('Migrated API key from global variable to settings');
    }
    
    if (!apiKey) {
        if (showValidationMessage) {
            const setNow = 'Set API Key Now';
            const result = await vscode.window.showErrorMessage(
                'OpenAI API key not set. Please set your API key in settings or use the command.',
                setNow
            );
            
            if (result === setNow) {
                vscode.commands.executeCommand('whisper-to-clipboard.setApiKey');
            }
        }
        return undefined;
    }
    
    // Basic validation - check if it starts with "sk-"
    if (!apiKey.startsWith('sk-')) {
        if (showValidationMessage) {
            const updateKey = 'Update Key';
            const result = await vscode.window.showErrorMessage(
                'Invalid OpenAI API key format. API keys should start with "sk-".',
                updateKey
            );
            
            if (result === updateKey) {
                vscode.commands.executeCommand('whisper-to-clipboard.setApiKey');
            }
        }
        return undefined;
    }
    
    return apiKey;
}

// Function to validate API key with OpenAI
async function validateApiKey(apiKey: string): Promise<boolean> {
    try {
        const testClient = new OpenAI({ apiKey });
        
        // Make a minimal API call to validate the key
        await testClient.models.list();
        return true;
    } catch (error: any) {
        console.error('API key validation error:', error);
        
        let errorMessage = 'Invalid API key or API access error.';
        if (error.status === 401) {
            errorMessage = 'Invalid API key. Please check your key and try again.';
        } else if (error.status === 403) {
            errorMessage = 'API key does not have access to the Whisper API. Please check your OpenAI account permissions.';
        } else if (error.message) {
            errorMessage = `API error: ${error.message}`;
        }
        
        vscode.window.showErrorMessage(errorMessage);
        return false;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Whisper to Clipboard extension is now active');

    // Initialize recording state context
    updateRecordingState(false);
    
    // Try to load API key from settings
    const config = vscode.workspace.getConfiguration('whisperToClipboard');
    globalApiKey = config.get<string>('openaiApiKey', '');
    
    if (globalApiKey) {
        openai = new OpenAI({ apiKey: globalApiKey });
        console.log('Loaded API key from settings');
    }

    // Create a status bar item to show recording status
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(unmute) Voice: Ready";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Create a clickable button in the status bar for recording
    recordButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    recordButton.text = "$(record) Start Recording";
    recordButton.tooltip = "Toggle voice recording (Cmd+Shift+R or Ctrl+Shift+R)";
    recordButton.command = "whisper-to-clipboard.toggleRecording";
    recordButton.show();
    context.subscriptions.push(recordButton);

    // Register webview provider for the chat panel
    const provider = {
        resolveWebviewView(webviewView: vscode.WebviewView) {
            webviewView.webview.options = {
                enableScripts: true
            };
            
            webviewView.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: sans-serif; padding: 10px; }
                    button { background: #007acc; color: white; border: none; padding: 8px 12px; cursor: pointer; margin-bottom: 10px; width: 100%; }
                    p { font-size: 12px; color: #666; margin-top: 20px; }
                </style>
            </head>
            <body>
                <button id="recordBtn">Start Voice Recording</button>
                <button id="openChatBtn">Open Chat Window</button>
                <button id="setDurationBtn">Set Recording Duration</button>
                <button id="setQualityBtn">Set Audio Quality</button>
                <button id="setLanguageBtn">Set Language Mode</button>
                <p><strong>Recorded text will ONLY be copied to your clipboard</strong> for easy pasting. No text will be inserted into the editor.</p>
                <p>Current max recording duration: <span id="durationDisplay">${getRecordingDuration()}</span> seconds</p>
                <p>Current audio quality: <span id="qualityDisplay">${getAudioQuality().description}</span></p>
                <p>Current language mode: <span id="languageDisplay">${getLanguageMode().description}</span></p>
                <script>
                    const vscode = acquireVsCodeApi();
                    const recordBtn = document.getElementById('recordBtn');
                    const openChatBtn = document.getElementById('openChatBtn');
                    const setDurationBtn = document.getElementById('setDurationBtn');
                    const setQualityBtn = document.getElementById('setQualityBtn');
                    const setLanguageBtn = document.getElementById('setLanguageBtn');
                    const durationDisplay = document.getElementById('durationDisplay');
                    const qualityDisplay = document.getElementById('qualityDisplay');
                    const languageDisplay = document.getElementById('languageDisplay');
                    let isRecording = false;
                    
                    recordBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'toggleRecording' });
                    });
                    
                    openChatBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openChat' });
                    });
                    
                    setDurationBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'setDuration' });
                    });
                    
                    setQualityBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'setQuality' });
                    });
                    
                    setLanguageBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'setLanguage' });
                    });
                    
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'updateRecordingState') {
                            isRecording = message.isRecording;
                            recordBtn.textContent = isRecording ? 'Stop Recording' : 'Start Voice Recording';
                        } else if (message.command === 'updateDuration') {
                            durationDisplay.textContent = message.duration;
                        } else if (message.command === 'updateAudioQuality') {
                            qualityDisplay.textContent = message.quality;
                        } else if (message.command === 'updateLanguageMode') {
                            languageDisplay.textContent = message.mode;
                        }
                    });
                </script>
            </body>
            </html>`;
            
            webviewView.webview.onDidReceiveMessage(message => {
                if (message.command === 'toggleRecording') {
                    vscode.commands.executeCommand('whisper-to-clipboard.toggleRecording');
                } else if (message.command === 'openChat') {
                    tryOpenChatWindow();
                } else if (message.command === 'setDuration') {
                    vscode.commands.executeCommand('whisper-to-clipboard.setRecordingDuration');
                } else if (message.command === 'setQuality') {
                    vscode.commands.executeCommand('whisper-to-clipboard.setAudioQuality');
                } else if (message.command === 'setLanguage') {
                    vscode.commands.executeCommand('whisper-to-clipboard.setLanguageMode');
                }
            });
            
            chatButton = webviewView;
        }
    };
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('whisper-to-clipboard.chatButton', provider as any)
    );

    // Register command to set API key
    let setApiKeyCommand = vscode.commands.registerCommand('whisper-to-clipboard.setApiKey', async () => {
        const config = vscode.workspace.getConfiguration('whisperToClipboard');
        const currentKey = await getApiKey(false) || '';
        
        const result = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API key (starts with sk-...)',
            password: true,
            value: currentKey
        });
        
        if (result !== undefined) {  // Only update if not cancelled
            if (result) {
                // Basic validation
                if (!result.startsWith('sk-')) {
                    vscode.window.showErrorMessage('Invalid API key format. OpenAI API keys should start with "sk-".');
                    return;
                }
                
                // Show validation in progress
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Validating OpenAI API key...",
                    cancellable: false
                }, async (progress) => {
                    const isValid = await validateApiKey(result);
                    
                    if (isValid) {
                        // Save to settings
                        await config.update('openaiApiKey', result, true);
                        globalApiKey = result;
                        openai = new OpenAI({ apiKey: result });
                        vscode.window.showInformationMessage('OpenAI API key has been set and validated successfully.');
                    }
                });
            } else {
                // Clear the API key if empty string was provided
                await config.update('openaiApiKey', '', true);
                globalApiKey = '';
                openai = null;
                vscode.window.showInformationMessage('OpenAI API key has been cleared.');
            }
        }
    });
    
    context.subscriptions.push(setApiKeyCommand);

    // Register command to set recording duration
    let setRecordingDurationCommand = vscode.commands.registerCommand('whisper-to-clipboard.setRecordingDuration', async () => {
        const currentDuration = getRecordingDuration();
        const result = await vscode.window.showInputBox({
            prompt: 'Enter maximum recording duration in seconds',
            value: currentDuration.toString(),
            validateInput: (value) => {
                const num = parseInt(value);
                return (isNaN(num) || num <= 0) ? 'Please enter a positive number' : null;
            }
        });
        
        if (result) {
            const duration = parseInt(result);
            await vscode.workspace.getConfiguration('whisperToClipboard').update('recordingDurationSeconds', duration, true);
            vscode.window.showInformationMessage(`Recording duration set to ${duration} seconds`);
            
            // Update the webview if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ command: 'updateDuration', duration: duration });
            }
        }
    });
    
    context.subscriptions.push(setRecordingDurationCommand);

    // Register command to set audio quality
    let setAudioQualityCommand = vscode.commands.registerCommand('whisper-to-clipboard.setAudioQuality', async () => {
        const currentQuality = vscode.workspace.getConfiguration('whisperToClipboard').get('audioQuality', 'standard');
        const options = [
            { label: 'Economy (16kHz)', description: 'Lower quality, smaller files, more economical for API usage', target: 'economy' },
            { label: 'Standard (24kHz)', description: 'Good balance between quality and cost', target: 'standard' },
            { label: 'High (44.1kHz)', description: 'Best transcription quality but larger files', target: 'high' }
        ];
        
        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select audio quality (affects API usage costs)',
            canPickMany: false
        });
        
        if (selected) {
            await vscode.workspace.getConfiguration('whisperToClipboard').update('audioQuality', selected.target, true);
            vscode.window.showInformationMessage(`Audio quality set to ${selected.label}`);
            
            // Update the webview if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ 
                    command: 'updateAudioQuality', 
                    quality: selected.label 
                });
            }
        }
    });
    
    context.subscriptions.push(setAudioQualityCommand);

    // Register command to set language mode
    let setLanguageModeCommand = vscode.commands.registerCommand('whisper-to-clipboard.setLanguageMode', async () => {
        const currentMode = vscode.workspace.getConfiguration('whisperToClipboard').get('languageMode', 'auto');
        const options = [
            { label: 'Auto-detect language', description: 'Let Whisper automatically detect the language', target: 'auto' },
            { label: 'English', description: 'Force English transcription', target: 'en' },
            { label: 'German (Deutsch)', description: 'Force German transcription', target: 'de' },
            { label: 'French (Français)', description: 'Force French transcription', target: 'fr' },
            { label: 'Spanish (Español)', description: 'Force Spanish transcription', target: 'es' },
            { label: 'Italian (Italiano)', description: 'Force Italian transcription', target: 'it' },
            { label: 'Portuguese (Português)', description: 'Force Portuguese transcription', target: 'pt' },
            { label: 'Dutch (Nederlands)', description: 'Force Dutch transcription', target: 'nl' },
            { label: 'Japanese (日本語)', description: 'Force Japanese transcription', target: 'ja' },
            { label: 'Chinese (中文)', description: 'Force Chinese transcription', target: 'zh' },
            { label: 'Russian (Русский)', description: 'Force Russian transcription', target: 'ru' }
        ];
        
        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select language mode for transcription',
            canPickMany: false
        });
        
        if (selected) {
            await vscode.workspace.getConfiguration('whisperToClipboard').update('languageMode', selected.target, true);
            vscode.window.showInformationMessage(`Language mode set to ${selected.label}`);
            
            // Update the webview if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ 
                    command: 'updateLanguageMode', 
                    mode: selected.label 
                });
            }
        }
    });
    
    context.subscriptions.push(setLanguageModeCommand);

    // Register a command to open chat window
    let openChatCommand = vscode.commands.registerCommand('whisper-to-clipboard.openChat', async () => {
        const success = await tryOpenChatWindow();
        if (!success) {
            vscode.window.showInformationMessage('Could not open chat window. Please open it manually.');
        }
    });
    
    context.subscriptions.push(openChatCommand);

    // Register a single command to toggle recording (start/stop)
    let toggleRecordingCommand = vscode.commands.registerCommand('whisper-to-clipboard.toggleRecording', async () => {
        if (isRecording) {
            // If already recording, stop recording
            await stopRecording();
        } else {
            // If not recording, start recording
            await startRecording();
        }
    });
    
    context.subscriptions.push(toggleRecordingCommand);
    
    // Register command to show chat button
    context.subscriptions.push(
        vscode.commands.registerCommand('whisper-to-clipboard.showChatButton', () => {
            vscode.commands.executeCommand('whisper-to-clipboard.chatButton.focus');
        })
    );

    // Function to start recording
    async function startRecording() {
        try {
            // Check if API key is set
            const apiKey = await getApiKey();
            if (!apiKey) {
                return; // getApiKey will show appropriate error message
            }
            
            // Initialize OpenAI client if needed
            if (!openai) {
                openai = new OpenAI({ apiKey });
            }

            // Create a temporary file path for the recording
            const tempDir = os.tmpdir();
            tempFilePath = path.join(tempDir, `voice-recording-${Date.now()}.wav`);
            
            // Get the configured recording duration
            const recordingDuration = getRecordingDuration();
            
            // Get the configured audio quality
            const audioQuality = getAudioQuality();
            
            // Start recording using the appropriate command based on the OS
            const platform = os.platform();
            
            if (platform === 'darwin') {
                // macOS - use sox with improved settings for better audio quality
                recordingProcess = child_process.spawn('rec', [
                    tempFilePath,
                    'rate', audioQuality.sampleRate, // Use configured sample rate
                    'channels', '1',
                    'trim', '0', recordingDuration.toString() // Use configured duration
                ]);
            } else if (platform === 'win32') {
                // Windows - not yet implemented
                vscode.window.showErrorMessage('Windows recording is not yet implemented. Please install sox for Windows and try again.');
                return;
            } else if (platform === 'linux') {
                // Linux - use arecord with improved settings
                recordingProcess = child_process.spawn('arecord', [
                    '-f', 'S16_LE',
                    '-c', '1',
                    '-r', audioQuality.sampleRate, // Use configured sample rate
                    '-d', recordingDuration.toString(), // Use configured duration
                    tempFilePath
                ]);
            } else {
                throw new Error(`Unsupported platform: ${platform}`);
            }
            
            // Handle recording process events
            recordingProcess.on('error', (err) => {
                vscode.window.showErrorMessage(`Recording failed to start: ${err.message}`);
                updateRecordingState(false);
                statusBarItem.text = "$(unmute) Voice: Error";
                recordButton.text = "$(record) Start Recording";
                
                // Update chat button if it exists
                if (chatButton) {
                    chatButton.webview.postMessage({ command: 'updateRecordingState', isRecording: false });
                }
            });
            
            // Add stdout and stderr handlers for better debugging
            recordingProcess.stdout?.on('data', (data) => {
                console.log(`Recording stdout: ${data}`);
            });
            
            recordingProcess.stderr?.on('data', (data) => {
                console.log(`Recording stderr: ${data}`);
            });
            
            // Update status
            updateRecordingState(true);
            statusBarItem.text = "$(record) Voice: Recording...";
            recordButton.text = "$(debug-stop) Stop Recording";
            
            // Update chat button if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ command: 'updateRecordingState', isRecording: true });
            }
            
            vscode.window.showInformationMessage(`Recording started (max ${recordingDuration}s, ${audioQuality.description} quality). Speak clearly into your microphone.`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start recording: ${error instanceof Error ? error.message : String(error)}`);
            updateRecordingState(false);
            statusBarItem.text = "$(unmute) Voice: Error";
        }
    }

    // Helper function to update status bar item
    function updateStatusBarItem() {
        if (!statusBarItem) {
            return;
        }
        
        if (isRecording) {
            statusBarItem.text = "$(record) Voice: Recording...";
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            statusBarItem.text = "$(unmute) Voice: Ready";
            statusBarItem.backgroundColor = undefined;
        }
        
        // Update recording button if it exists
        if (recordButton) {
            recordButton.text = isRecording ? "$(debug-stop) Stop Recording" : "$(record) Start Recording";
        }
        
        // Update chat button if it exists
        if (chatButton) {
            chatButton.webview.postMessage({ command: 'updateRecordingState', isRecording });
        }
    }

    async function stopRecording() {
        if (!recordingProcess) {
            vscode.window.showInformationMessage('No recording in progress.');
            return;
        }

        try {
            // Stop the recording process
            recordingProcess.kill();
            recordingProcess = null;
            
            // Update status
            isRecording = false;
            updateStatusBarItem();
            
            // Wait a moment for the file to be properly saved
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if the audio file exists and has content
            if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size === 0) {
                vscode.window.showErrorMessage('Recording failed: No audio data captured.');
                return;
            }
            
            // Show transcription in progress message
            vscode.window.setStatusBarMessage('Transcribing audio...', 10000);
            
            // Get the OpenAI API key
            const apiKey = await getApiKey();
            if (!apiKey) {
                return; // getApiKey will show appropriate error message
            }
            
            // Create OpenAI client
            const openaiClient = new OpenAI({
                apiKey: apiKey
            });
            
            // Get language mode setting
            const languageMode = getLanguageMode();
            
            try {
                // Check if the recording is long and needs to be split
                const recordingDuration = getRecordingDuration();
                let audioFiles: string[] = [tempFilePath];
                
                // For recordings longer than 60 seconds, try to split into chunks
                if (recordingDuration > 60) {
                    const hasFFmpeg = await isFFmpegInstalled();
                    if (hasFFmpeg) {
                        vscode.window.setStatusBarMessage('Processing long recording...', 5000);
                        audioFiles = await splitAudioFile(tempFilePath);
                        
                        if (audioFiles.length > 1) {
                            vscode.window.showInformationMessage(`Long recording detected. Processing in ${audioFiles.length} chunks for better accuracy.`);
                        }
                    } else {
                        vscode.window.showWarningMessage('Long recording detected but FFmpeg not found. Transcription may be less accurate.');
                    }
                }
                
                // Transcribe the audio
                const transcription = await transcribeAudio(audioFiles, openaiClient, languageMode);
                
                if (!transcription || transcription.trim().length === 0) {
                    vscode.window.showWarningMessage('No speech detected in the recording.');
                    return;
                }
                
                // Copy to clipboard
                await vscode.env.clipboard.writeText(transcription);
                
                // Show success message with first few words of transcription
                const previewText = transcription.length > 30 
                    ? transcription.substring(0, 30) + '...' 
                    : transcription;
                vscode.window.showInformationMessage(`Transcription copied to clipboard: "${previewText}"`);
                
                // Clean up temporary files
                cleanupTempFiles(audioFiles);
                
            } catch (error: any) {
                console.error('Error during transcription:', error);
                
                // Save debug audio file if transcription failed
                const homeDir = os.homedir();
                const debugAudioFile = path.join(homeDir, 'whisper_debug_audio.wav');
                try {
                    fs.copyFileSync(tempFilePath, debugAudioFile);
                    vscode.window.showErrorMessage(`Transcription failed: ${error.message}. Debug audio saved to ${debugAudioFile}`);
                } catch (copyError) {
                    vscode.window.showErrorMessage(`Transcription failed: ${error.message}. Could not save debug audio.`);
                }
            }
        } catch (error: any) {
            console.error('Error stopping recording:', error);
            vscode.window.showErrorMessage(`Error stopping recording: ${error.message}`);
        } finally {
            // Reset recording state
            isRecording = false;
            updateStatusBarItem();
        }
    }

    // Helper function to clean up temporary files
    function cleanupTempFiles(files: string[]) {
        for (const file of files) {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`Deleted temporary file: ${file}`);
                }
            } catch (error) {
                console.error(`Error deleting temporary file ${file}:`, error);
            }
        }
    }
}

export function deactivate() {
    // Clean up any resources
    if (recordingProcess) {
        recordingProcess.kill();
        recordingProcess = null;
    }
    
    if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
            fs.unlinkSync(tempFilePath);
        } catch (e) {
            console.error('Failed to delete temporary file during deactivation:', e);
        }
    }
} 