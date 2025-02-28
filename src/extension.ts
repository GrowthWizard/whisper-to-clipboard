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

// Function to update the recording state context
function updateRecordingState(recording: boolean) {
    isRecording = recording;
    vscode.commands.executeCommand('setContext', 'isRecording', recording);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Whisper to Clipboard extension is now active');

    // Initialize recording state context
    updateRecordingState(false);

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
                <p><strong>Recorded text will ONLY be copied to your clipboard</strong> for easy pasting. No text will be inserted into the editor.</p>
                <script>
                    const vscode = acquireVsCodeApi();
                    const recordBtn = document.getElementById('recordBtn');
                    const openChatBtn = document.getElementById('openChatBtn');
                    let isRecording = false;
                    
                    recordBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'toggleRecording' });
                    });
                    
                    openChatBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openChat' });
                    });
                    
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'updateRecordingState') {
                            isRecording = message.isRecording;
                            recordBtn.textContent = isRecording ? 'Stop Recording' : 'Start Voice Recording';
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
        const result = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API key (starts with sk-...)',
            password: true,
            value: apiKey
        });
        
        if (result) {
            apiKey = result;
            openai = new OpenAI({ apiKey });
            vscode.window.showInformationMessage('OpenAI API key has been set');
        }
    });
    
    context.subscriptions.push(setApiKeyCommand);

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
            if (!apiKey) {
                const result = await vscode.window.showInputBox({
                    prompt: 'Please enter your OpenAI API key (starts with sk-...)',
                    password: true
                });
                
                if (!result) {
                    vscode.window.showErrorMessage('OpenAI API key is required for voice transcription');
                    return;
                }
                
                apiKey = result;
                openai = new OpenAI({ apiKey });
            }

            // Create a temporary file path for the recording
            const tempDir = os.tmpdir();
            tempFilePath = path.join(tempDir, `voice-recording-${Date.now()}.wav`);
            
            // Start recording using the appropriate command based on the OS
            const platform = os.platform();
            
            if (platform === 'darwin') {
                // macOS - use sox
                recordingProcess = child_process.spawn('rec', [
                    tempFilePath,
                    'rate', '16k',
                    'channels', '1',
                    'trim', '0', '30' // Limit to 30 seconds as a safety measure
                ]);
            } else if (platform === 'win32') {
                // Windows - not yet implemented
                vscode.window.showErrorMessage('Windows recording is not yet implemented. Please install sox for Windows and try again.');
                return;
            } else if (platform === 'linux') {
                // Linux - use arecord
                recordingProcess = child_process.spawn('arecord', [
                    '-f', 'S16_LE',
                    '-c', '1',
                    '-r', '16000',
                    '-d', '30', // Limit to 30 seconds as a safety measure
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
            
            // Update status
            updateRecordingState(true);
            statusBarItem.text = "$(record) Voice: Recording...";
            recordButton.text = "$(debug-stop) Stop Recording";
            
            // Update chat button if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ command: 'updateRecordingState', isRecording: true });
            }
            
            vscode.window.showInformationMessage('Recording started. Speak clearly into your microphone.');
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start recording: ${error instanceof Error ? error.message : String(error)}`);
            updateRecordingState(false);
            statusBarItem.text = "$(unmute) Voice: Error";
        }
    }

    // Function to stop recording
    async function stopRecording() {
        if (!recordingProcess) {
            vscode.window.showInformationMessage('Not currently recording!');
            return;
        }
        
        try {
            // Stop the recording process
            recordingProcess.kill();
            recordingProcess = null;
            updateRecordingState(false);
            
            // Update status
            statusBarItem.text = "$(sync~spin) Voice: Transcribing...";
            recordButton.text = "$(record) Start Recording";
            
            // Update chat button if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ command: 'updateRecordingState', isRecording: false });
            }
            
            // Wait a moment for the file to be properly saved
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Show a progress notification while transcribing
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Transcribing audio...",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });
                
                try {
                    if (!openai) {
                        throw new Error('OpenAI client not initialized');
                    }
                    
                    // Check if the file exists and has content
                    if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size === 0) {
                        throw new Error('No audio was recorded or the file is empty');
                    }
                    
                    // Transcribe the audio using OpenAI's Whisper API
                    const transcription = await openai.audio.transcriptions.create({
                        file: fs.createReadStream(tempFilePath),
                        model: "whisper-1",
                    });
                    
                    progress.report({ increment: 100 });
                    
                    // ONLY copy the transcribed text to clipboard
                    await copyToClipboard(transcription.text);
                    
                    // Clean up the temporary file
                    try {
                        fs.unlinkSync(tempFilePath);
                    } catch (e) {
                        console.error('Failed to delete temporary file:', e);
                    }
                    
                    statusBarItem.text = "$(unmute) Voice: Ready";
                    
                } catch (error) {
                    console.error('Transcription error:', error);
                    vscode.window.showErrorMessage(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
                    statusBarItem.text = "$(unmute) Voice: Error";
                    recordButton.text = "$(record) Start Recording";
                }
            });
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to stop recording: ${error instanceof Error ? error.message : String(error)}`);
            statusBarItem.text = "$(unmute) Voice: Error";
            
            // Reset recording state
            updateRecordingState(false);
            recordingProcess = null;
            recordButton.text = "$(record) Start Recording";
            
            // Update chat button if it exists
            if (chatButton) {
                chatButton.webview.postMessage({ command: 'updateRecordingState', isRecording: false });
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