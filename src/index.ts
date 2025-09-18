import { Agent, MCPTransport } from '@smythos/sdk';

import { DockerExecutor } from './DockerExecutor.class';

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCarriageReturn(input: string): string {
    return input.replace(/\\r/g, '\r');
}

// Helper function to convert escape sequences
function parseEscapeSequences(input: string): string {
    const original = input;
    const result = input
        // Handle Unicode escape sequences like \u001b (ESC)
        .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
            const char = String.fromCharCode(parseInt(hex, 16));
            //console.log(`Converted Unicode escape ${match} to character code ${parseInt(hex, 16)}`);
            return char;
        })
        // Handle common escape sequences
        .replace(/\\n/g, '\n') // Newline
        .replace(/\\r/g, '\r') // Carriage return
        .replace(/\\t/g, '\t') // Tab
        .replace(/\\b/g, '\b') // Backspace
        .replace(/\\f/g, '\f') // Form feed
        .replace(/\\v/g, '\v') // Vertical tab
        .replace(/\\0/g, '\0') // Null character
        // Handle octal escape sequences like \033 (ESC)
        .replace(/\\([0-7]{1,3})/g, (match, octal) => {
            const char = String.fromCharCode(parseInt(octal, 8));
            //console.log(`Converted octal escape ${match} to character code ${parseInt(octal, 8)}`);
            return char;
        })
        // Handle hex escape sequences like \x1b (ESC)
        .replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) => {
            const char = String.fromCharCode(parseInt(hex, 16));
            //console.log(`Converted hex escape ${match} to character code ${parseInt(hex, 16)}`);
            return char;
        })
        // Handle literal backslashes (must be last)
        .replace(/\\\\/g, '\\');

    if (original !== result) {
        //console.log(`Escape sequence conversion: "${original}" -> converted to special characters`);
    }

    return result;
}

async function main() {
    const agent = new Agent({
        name: 'Linux Sandbox Executor',
        model: 'gpt-4o',
        behavior: 'You are a helpful assistant that can Spawn linux containers and run commands in them.',
    });
    const dockerExecutor = new DockerExecutor('ubuntu:latest');
    agent.addSkill({
        name: 'SpawnContainer',
        description: 'Spawns a new linux container.',
        process: async () => {
            try {
                await dockerExecutor.runNewContainer();
                await dockerExecutor.ready();

                dockerExecutor.updateStatus('Container spawned successfully');
                return 'Container spawned successfully';
            } catch (error) {
                //console.error('Error spawning container:', error);
                return 'Error spawning container ' + error.message;
            }
        },
    });

    agent.addSkill({
        name: 'SendTTYInput',
        description:
            'Send an arbitrary input to a linux container. this will be sent as a TTY input to the container and will return the output buffer after the specified number of seconds. If you want to send a command or are prompted to enter a value, make sure to send the command with a \r at the end.Note : \r is the only special character interpreted by SendTTYInput if you want to send any special character use SendTTYInputWithEscapeSequences',
        process: async ({ ttyInput, wait_seconds }: { ttyInput: string; wait_seconds: number }) => {
            if (ttyInput.trim()) {
                const parsedInput = parseCarriageReturn(ttyInput);
                dockerExecutor.updateStatus(`Running command: ${ttyInput}`);
                await dockerExecutor.sendInput(parsedInput);
            }
            await delay(Math.max(wait_seconds * 1000, 3000));
            const output = await dockerExecutor.buffer;
            return output;
        },
    });

    agent.addSkill({
        name: 'SendTTYInputWithEscapeSequences',
        description:
            'Send an arbitrary input to a linux container and will interpret escape sequences. It can be a single character (e.g \r to simulate a Enter press) or a sequence (e.g \b\b\b to simulate backspaces) this will be sent as a TTY input to the container and will return the output buffer after the specified number of seconds.',
        process: async ({ ttyInput, wait_seconds }: { ttyInput: string; wait_seconds: number }) => {
            if (ttyInput.trim()) {
                const parsedInput = parseEscapeSequences(ttyInput);
                dockerExecutor.updateStatus(`Running command: ${ttyInput}`);
                await dockerExecutor.sendInput(parsedInput);
            }
            await delay(Math.max(wait_seconds * 1000, 3000));
            const output = await dockerExecutor.buffer;
            return output;
        },
    });

    agent.addSkill({
        name: 'StopAndDestroyContainer',
        description: 'Stop and destroy a linux container.',
        process: async () => {
            await dockerExecutor.stop();
            return 'Container stopped successfully';
        },
    });

    agent.addSkill({
        name: 'GetScreenContent',
        description: 'Reads the current screen buffer. use it to read the output of a recent command or know what is being displayed on the screen.',
        process: async () => {
            const output = await dockerExecutor.buffer;
            return output;
        },
    });

    console.log('Smyth Docker Commander');
    console.log('--------------------------------');
    console.log('This MCP can spawn a linux sandbox container using docker and run commands in it.');
    console.log('--------------------------------');
    const url = await agent.mcp(MCPTransport.SSE);
    console.log('MCP url: ', url);
}

main();
