import Docker from 'dockerode';
import * as tty from 'tty';
const docker = new Docker();

// Cast stdin/stdout to TTY streams for proper typing

const stdin = process.stdin as tty.ReadStream;
import { updateStatus, clearStatus, stdout } from './stdout.helper';

// Utility function for delays
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DockerExecutor {
    private container: Docker.Container | null = null;
    private ttyStream: any | undefined;
    private _buffer: string = '';
    private onDataCallback: ((data: string) => void) | null = null;
    private isFirstData = true;
    private shouldStop = false;

    private readyPromise: Promise<void>;
    private readyResolve: (() => void) | null = null;

    public get buffer(): string {
        return this._buffer;
    }

    constructor(private imageName: string) {
        // Initialize the ready promise
        this.readyPromise = new Promise<void>((resolve) => {
            this.readyResolve = resolve;
        });

        // Ensure we're in a TTY context
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            console.error('This script must be run in a TTY environment');
            process.exit(1);
        }

        this.setupProcessSignals();
    }

    // Method to update status - now handled internally
    public updateStatus(message: string) {
        updateStatus(message);
    }

    // Method to clear status - now handled internally
    public clearStatus() {
        clearStatus();
    }

    // Method to wait for container to be ready
    public ready(): Promise<void> {
        return this.readyPromise;
    }

    // Method to set a callback for when data is received
    // public setOnDataCallback(callback: (data: string) => void) {
    //     this.onDataCallback = callback;
    // }

    // Method to stop the container
    public stop() {
        this.shouldStop = true;

        this.updateStatus('Stop command received - shutting down...');
        // Clear status after a short delay
        setTimeout(() => {
            this.clearStatus();
        }, 2000);
        this.ttyStream?.end();
    }

    // Reset state for new container operations
    private resetState() {
        this.container = null;
        this.ttyStream = undefined;
        this._buffer = '';
        this.isFirstData = true;
        this.shouldStop = false;

        // Reset the ready promise for the next container
        this.readyPromise = new Promise<void>((resolve) => {
            this.readyResolve = resolve;
        });
    }

    // Check if the executor is ready for a new container
    public isReady(): boolean {
        return this.container === null && this.ttyStream === undefined;
    }

    // Create and run a new container with a different image if desired
    public async runNewContainer(imageName?: string): Promise<void> {
        if (!this.isReady()) {
            throw new Error('DockerExecutor is still managing an active container. End the current session first.');
        }

        if (imageName) {
            this.imageName = imageName;
        }

        return this.runContainer();
    }
    async sendInput(command: string) {
        this.ttyStream?.write(command);
    }

    // Check if Docker Engine is available
    private async checkDockerAvailable(): Promise<boolean> {
        try {
            await docker.ping();
            return true;
        } catch (error: any) {
            return false;
        }
    }

    async createContainer(): Promise<Docker.Container> {
        const image = this.imageName;

        // Check if Docker Engine is available
        this.updateStatus('Checking Docker Engine availability...');
        const isDockerAvailable = await this.checkDockerAvailable();

        if (!isDockerAvailable) {
            this.clearStatus();
            throw new Error(
                'Docker Engine is not running or not accessible.\n' +
                    'Please ensure Docker Desktop is started and running.\n' +
                    '• On Windows: Start Docker Desktop from the Start menu\n' +
                    '• On macOS: Start Docker Desktop from Applications\n' +
                    '• On Linux: Start the Docker daemon (sudo systemctl start docker)\n' +
                    '\nOnce Docker is running, try again.'
            );
        }

        console.log(`Pulling image: ${image}`);
        this.updateStatus(`Pulling image: ${image}...`);

        try {
            await new Promise<void>((resolve, reject) => {
                docker.pull(image, (err: Error, stream: NodeJS.ReadableStream) => {
                    if (err) {
                        return reject(err);
                    }
                    docker.modem.followProgress(stream, (err, output) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve();
                    });
                });
            });
            console.log('Image pulled.');
        } catch (error: any) {
            this.clearStatus();
            if (error.message.includes('ENOENT') || error.message.includes('docker_engine')) {
                throw new Error(
                    'Lost connection to Docker Engine during image pull.\n' + 'Please ensure Docker Desktop remains running and try again.'
                );
            }
            throw error; // Re-throw other errors
        }

        this.updateStatus('Creating container...');
        try {
            const container = await docker.createContainer({
                Image: image,
                Tty: true,
                Cmd: ['/bin/bash'],
                OpenStdin: true,
                StdinOnce: false,
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
            });
            this.updateStatus('Container created');
            this.container = container;
            return container;
        } catch (error: any) {
            this.clearStatus();
            if (error.message.includes('ENOENT') || error.message.includes('docker_engine')) {
                throw new Error(
                    'Lost connection to Docker Engine during container creation.\n' + 'Please ensure Docker Desktop remains running and try again.'
                );
            }
            throw error; // Re-throw other errors
        }
    }

    private setupProcessSignals() {
        // Flag to prevent multiple cleanup attempts
        let isCleaningUp = false;

        const performCleanup = async (signal?: string) => {
            if (isCleaningUp) return;
            isCleaningUp = true;

            this.clearStatus();
            if (signal) {
                console.log(`\nReceived ${signal} - cleaning up...`);
            }

            try {
                // Restore terminal first
                this.restoreTerminal();

                // Destroy container if it exists
                if (this.container) {
                    console.log('Destroying container...');
                    await this.destroyContainer();
                    console.log('Container destroyed successfully');
                }
            } catch (error) {
                console.error('Error during cleanup:', error);
            } finally {
                process.exit(0);
            }
        };

        // Handle common termination signals
        process.on('SIGINT', () => {
            performCleanup('SIGINT').catch(() => process.exit(1));
        });

        process.on('SIGTERM', () => {
            performCleanup('SIGTERM').catch(() => process.exit(1));
        });

        process.on('SIGQUIT', () => {
            performCleanup('SIGQUIT').catch(() => process.exit(1));
        });

        process.on('SIGHUP', () => {
            performCleanup('SIGHUP').catch(() => process.exit(1));
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
            performCleanup().catch(() => process.exit(1));
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
            performCleanup().catch(() => process.exit(1));
        });

        // Ensure cleanup on normal exit (synchronous only)
        process.on('exit', () => {
            this.restoreTerminal();
            // Note: Cannot perform async cleanup here, but we've handled
            // all async termination scenarios above
        });

        // Handle beforeExit for graceful shutdown
        process.on('beforeExit', (code) => {
            if (!isCleaningUp && this.container) {
                console.log('Process exiting - performing final cleanup...');
                performCleanup().catch(() => process.exit(code || 1));
            }
        });
    }

    // Setup terminal to reserve bottom lines - runs after container is ready
    private async setupTerminalReservation() {
        if (!this.ttyStream) return;

        // Get actual terminal dimensions from Node.js
        const actualRows = stdout.rows || 24;
        const actualCols = stdout.columns || 80;
        const usableRows = actualRows - 2;

        this.updateStatus('Configuring terminal to reserve status area...');

        // Send terminal setup commands one by one with delays
        await this.sendInput(`export LINES=${usableRows}\r`);
        await delay(200);

        await this.sendInput(`export COLUMNS=${actualCols}\r`);
        await delay(200);

        await this.sendInput(`tput csr 0 ${usableRows - 1}\r`);
        await delay(300);

        await this.sendInput(`clear\r`);
        await delay(200);

        await this.sendInput(`tput cup 0 0\r`);
        await delay(200);

        await this.sendInput(`clear\r`);
        await delay(200);

        this.updateStatus(`Terminal configured: ${usableRows}x${actualCols} (reserved 2 bottom lines)`);
    }

    // Handle internal commands (better than external callback)
    private handleInternalCommand(command: string) {
        switch (command) {
            case 'STOP':
            case 'EXIT':
            case 'QUIT':
                this.updateStatus('Stopping container...');
                this.stop();
                break;
            case 'HELP':
            case '?':
                this.updateStatus('Commands: STOP/EXIT/QUIT - Stop container, HELP/? - Show help. Use F12 to enter command mode.');
                break;
            case 'STATUS':
                this.updateStatus(`Container running. Buffer size: ${this._buffer.length} chars. TTY active.`);
                break;
            case 'CLEAR':
                this._buffer = '';
                this.updateStatus('Buffer cleared.');
                break;
            default:
                if (command.trim() === '') {
                    this.updateStatus('Command mode cancelled.');
                } else {
                    this.updateStatus(`Unknown command: ${command}. Available: STOP, HELP, STATUS, CLEAR`);
                }
                break;
        }
    }

    private async setupTTYStream() {
        // Create TTY stream with hijack mode
        this.ttyStream = await this.container?.attach({
            stream: true,
            stdin: true,
            stdout: true,
            stderr: true,
            hijack: true,
        });

        // Process next command in queue

        // Handle the hijacked stream properly
        this.ttyStream?.on('data', async (chunk: Buffer) => {
            // For TTY mode, Docker doesn't use stream multiplexing, so we can write directly
            const data = chunk.toString();

            // Filter out Docker metadata that might appear at any time
            // Check if this looks like JSON metadata from Docker
            const isDockerMetadata =
                data.includes('"stream":') ||
                data.includes('"hijack":') ||
                data.includes('"stderr":') ||
                data.includes('"stdin":') ||
                data.includes('"stdout":') ||
                data.includes('stream:true') ||
                data.includes('hijack:true') ||
                data.includes('stdin:true') ||
                data.includes('stdout:true') ||
                data.includes('stderr:true') ||
                (data.startsWith('{') && data.includes('":true}')) ||
                (data.includes('{"') && data.includes('":true')) ||
                data.trim().match(/^[{"].*stream.*true.*[}"]$/);

            if (isDockerMetadata) {
                // This is Docker metadata, skip it completely
                //console.log(`[DEBUG] Filtered Docker metadata: ${data.replace(/\n/g, '\\n')}`);
                return;
            }

            // Mark that we've seen real data (not just metadata)
            if (this.isFirstData && data.trim().length > 0) {
                this.isFirstData = false;
            }

            stdout.write(chunk);

            // Add to buffer for pattern matching
            this._buffer += data;
            // Keep buffer manageable
            if (this._buffer.length > 10000) {
                this._buffer = this._buffer.slice(-5000);
            }

            // Check if container is ready (initial prompt appeared or any meaningful output)
            if (this.readyResolve) {
                // Look for bash prompt patterns or any substantial output indicating the container is running
                const hasPrompt = data.includes('root@') || data.includes('# ') || data.includes('$ ');
                const hasOutput = data.trim().length > 10 && !isDockerMetadata;
                const hasNewline = data.includes('\n');

                if (hasPrompt || (hasOutput && hasNewline)) {
                    //console.log(`[DEBUG] Container ready detected from: "${data.replace(/\n/g, '\\n')}"`);
                    this.readyResolve();
                    this.readyResolve = null; // Ensure it's only called once
                }
            }

            // Call the external callback if set
            if (this.onDataCallback) {
                this.onDataCallback(data);
            }
        });

        // Handle container TTY stream end
        this.ttyStream?.on('end', async () => {
            // Clear status first
            this.clearStatus();

            if (this.shouldStop) {
                console.log('\n\nContainer TTY session ended by user command');
            } else {
                console.log('\n\nContainer TTY session ended unexpectedly');
            }

            this.restoreTerminal();
            if (this.container) {
                await this.destroyContainer();
            }

            // Reset state for potential new containers
            this.resetState();
            console.log('\n📦 Container session ended. Ready for new operations.');
        });

        // Handle TTY stream errors
        this.ttyStream?.on('error', (error: Error) => {
            // Clear status first
            this.clearStatus();
            console.error(`Container TTY error: ${error.message}`);
            this.restoreTerminal();
            if (this.container) {
                this.destroyContainer().finally(() => {
                    this.resetState();
                    console.log('\n📦 Container session ended due to error. Ready for new operations.');
                });
            } else {
                this.resetState();
                console.log('\n📦 Ready for new operations.');
            }
        });
    }

    private setupTTYSTDIN() {
        // Set stdin to raw mode for character-by-character input
        stdin.setRawMode(true);
        stdin.resume();

        // Buffer for collecting command input
        let commandBuffer = '';
        let isInCommandMode = false;

        // Forward stdin from console to container (for manual interaction if needed)
        stdin.on('data', (data) => {
            const input = data.toString();

            // Handle Ctrl+C (ASCII 3)
            if (data[0] === 3) {
                // Clear status first
                this.clearStatus();
                console.log('\n^C - Ending container session');
                this.ttyStream?.end();
                this.restoreTerminal();
                if (this.container) {
                    this.destroyContainer().finally(() => {
                        this.resetState();
                        console.log('\n📦 Container session ended. Ready for new operations.');
                    });
                } else {
                    this.resetState();
                    console.log('\n📦 Ready for new operations.');
                }
                return;
            }

            // Handle F12 key to enter command mode - universal across all keyboards
            // F12 sends escape sequence: \x1b[24~
            if (input === '\x1b[24~') {
                isInCommandMode = true;
                commandBuffer = '';
                // Echo command mode indicator
                stdout.write('\n🔧 Command mode (F12 to activate): ');
                return;
            }

            // If in command mode, collect the command
            if (isInCommandMode) {
                // Handle backspace in command mode
                if (data[0] === 127 || data[0] === 8) {
                    // Backspace or Delete
                    if (commandBuffer.length > 0) {
                        commandBuffer = commandBuffer.slice(0, -1);
                        stdout.write('\b \b'); // Erase character
                    } else {
                        // Exit command mode if no characters left
                        isInCommandMode = false;
                        commandBuffer = '';
                        stdout.write('\n'); // Clear command line
                    }
                    return;
                }

                // Handle enter in command mode
                if (data[0] === 13 || data[0] === 10) {
                    // Enter or newline
                    const command = commandBuffer.trim().toUpperCase();
                    stdout.write(`\n`); // New line after command

                    // Handle internal commands
                    this.handleInternalCommand(command);

                    // Reset command mode
                    isInCommandMode = false;
                    commandBuffer = '';
                    return;
                }

                // Add character to command buffer
                if (data[0] >= 32 && data[0] <= 126) {
                    // Printable ASCII
                    commandBuffer += input;
                    stdout.write(input); // Echo the character
                }
                return;
            }

            // Forward regular input to container (allows manual interaction)
            this.ttyStream?.write(data);
        });
    }
    async runContainer() {
        try {
            this.updateStatus('Initializing container...');
            // First create the container
            await this.createContainer();

            // Then start it
            this.updateStatus('Starting container...');
            await this.container?.start();
            this.updateStatus('Container started - TTY session active');

            console.log(`Terminal size: ${stdout.columns}x${stdout.rows}`);
            console.log('Starting container TTY session. You will see all operations in real-time...');
            console.log('💡 Tip: Press F12 to enter command mode, then type HELP or STOP\n');

            await this.setupTTYStream();
            this.setupTTYSTDIN();

            // Start processing commands
            (async () => {
                await delay(1000);
                this.updateStatus('Getting initial prompt...');
                this.ttyStream?.write('\r'); // Send enter to get initial prompt

                // Wait for container to be ready, then setup terminal
                await this.ready();
                await delay(500); // Give it a moment after ready
                await this.setupTerminalReservation();

                // Fallback: resolve ready promise after 5 seconds if not already resolved
                await delay(5000);
                if (this.readyResolve) {
                    //console.log('[DEBUG] Container ready timeout - assuming container is ready');
                    this.readyResolve();
                    this.readyResolve = null;
                }
            })();
        } catch (error: any) {
            // Clear status first
            this.clearStatus();

            // Check if this is a Docker availability error
            if (error.message.includes('Docker Engine is not running') || error.message.includes('Lost connection to Docker Engine')) {
                console.error('\n❌ Docker Error:');
                console.error(error.message);
                console.error('\nPlease start Docker and try again.');
            } else {
                console.error('\n❌ An error occurred:', error.message || error);
            }

            // Restore terminal
            this.restoreTerminal();

            // Try to cleanup container if it exists
            if (this.container) {
                try {
                    console.log('\nCleaning up partial container...');
                    await this.destroyContainer();
                } catch (cleanupError) {
                    console.error('Warning: Could not cleanup container:', cleanupError);
                }
            }

            // Reset state instead of exiting
            this.resetState();
            console.log('\n📦 Container operation failed. Ready for new operations.');
        }
    }

    async destroyContainer() {
        this.updateStatus('Destroying container...');
        try {
            // Check if Docker is still available
            const isDockerAvailable = await this.checkDockerAvailable();
            if (!isDockerAvailable) {
                this.updateStatus('Docker not available - container may already be cleaned up');
                await new Promise((resolve) => setTimeout(resolve, 1000));
                this.clearStatus();
                return;
            }

            try {
                await this.container?.stop();
            } catch (error: any) {
                if (error.statusCode !== 304) {
                    // 304 is "Not Modified", container already stopped
                    // Check if it's a Docker connection error
                    if (error.message.includes('ENOENT') || error.message.includes('docker_engine')) {
                        this.updateStatus('Docker connection lost - container cleanup skipped');
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        this.clearStatus();
                        return;
                    }
                    throw error;
                }
            }

            await this.container?.remove();
            this.updateStatus('Container destroyed');
        } catch (error: any) {
            // If Docker connection is lost during cleanup, just log it
            if (error.message.includes('ENOENT') || error.message.includes('docker_engine')) {
                this.updateStatus('Docker connection lost during cleanup');
                console.log('Warning: Could not connect to Docker for cleanup - container may need manual removal');
            } else {
                //throw error; // Re-throw other errors
                if (error.statusCode !== 409) {
                    //409 means container remove is in progress, so we can ignore it
                    console.log('Error during cleanup:', error.message || error);
                }
            }
        }

        // Clear status after a short delay, but before terminal restoration
        await new Promise((resolve) => setTimeout(resolve, 1500));
        this.clearStatus();
    }

    // Function to restore terminal to normal mode
    private restoreTerminal() {
        // Clear status line before restoring terminal
        this.clearStatus();
        if (stdin.isRaw) {
            stdin.setRawMode(false);
        }
        stdin.pause();
    }
}
