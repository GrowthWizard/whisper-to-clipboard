import * as vscode from 'vscode';

/**
 * This module provides clipboard integration for the Voice-to-Text extension.
 * It focuses ONLY on clipboard operations and does not insert text into any editor.
 */

/**
 * Copies text to the clipboard and shows a notification
 * @param text The text to copy to clipboard
 * @returns A promise that resolves to true if successful, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        // ONLY copy text to clipboard using the VS Code API
        await vscode.env.clipboard.writeText(text);
        
        // Show notification to user
        vscode.window.showInformationMessage(
            'Text copied to clipboard. Paste it with Cmd+V (Mac) or Ctrl+V (Windows/Linux).',
            'Open Chat'
        ).then(selection => {
            if (selection === 'Open Chat') {
                // Try to open chat window
                tryOpenChatWindow();
            }
        });
        
        return true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        vscode.window.showErrorMessage(`Failed to copy to clipboard: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Attempts to open the chat window
 */
export async function tryOpenChatWindow(): Promise<boolean> {
    try {
        const commands = await vscode.commands.getCommands(true);
        
        // Try each of these commands to open the chat window
        const chatCommands = [
            'cursor.openChat',
            'cursor.chat.focus'
        ].filter(cmd => commands.includes(cmd));
        
        if (chatCommands.length > 0) {
            for (const cmd of chatCommands) {
                try {
                    await vscode.commands.executeCommand(cmd);
                    return true;
                } catch (e) {
                    console.log(`Command ${cmd} failed:`, e);
                    // Continue to next command
                }
            }
        }
        
        return false;
    } catch (error) {
        console.error('Failed to open chat window:', error);
        return false;
    }
} 