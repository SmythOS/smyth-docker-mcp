# Smyth Docker Commander (MCP Server)

A Model Context Protocol (MCP) server built with `@smythos/sdk` that can spawn an ephemeral Linux sandbox using Docker and execute commands inside it via an interactive TTY.

https://www.youtube.com/watch?v=JgRRSQ1_YAE

[![Smyth Docker MCP](https://img.youtube.com/vi/JgRRSQ1_YAE/0.jpg)](https://www.youtube.com/watch?v=JgRRSQ1_YAE)

**Key Features:**

-   **Full TTY Interface**: Exposes a complete terminal interface allowing MCP clients to send commands, keystrokes, and special key sequences while capturing all output in real-time
-   **Collaborative Interaction**: While the MCP server is running, both the AI client (Claude/Gemini) and the human user can simultaneously interact with the same container terminal, enabling true "teamwork" scenarios
-   **Real-time Output Capture**: Maintains a rolling buffer of terminal output that clients can read at any time to understand the current state

When launched, it starts an MCP server over Server-Sent Events (SSE) and exposes a set of skills that MCP clients (e.g., Claude Code, gemini-cli) can call:

-   **SpawnContainer**: Pulls the specified image (default `ubuntu:latest`) and starts a TTY `bash` session.
-   **SendTTYInput**: Sends input to the container TTY. Interprets only `\r` (carriage return). Use this to send shell commands terminated with `\r`.
-   **SendTTYInputWithEscapeSequences**: Sends input and interprets common escape sequences (e.g., `\r`, `\b`, `\t`, `\x1b`, octal like `\033`).
-   **GetScreenContent**: Returns the rolling output buffer (last ~5–10k chars) from the container.
-   **StopAndDestroyContainer**: Stops and removes the container, restoring the local terminal.

It uses `dockerode` under the hood and provides a status line UI in the terminal.

## Getting Started

### Prerequisites

-   Node.js v20+
-   Docker Desktop/Engine running and accessible (the server pings Docker and will error if unavailable)
-   An OpenAI (or other) API key configured in .smyth/.sre/vault.json, you can move this folder to your home directory if you don't want it to be in the project directory (~/.smyth/.sre/vault.json)

### Install

```bash
npm install
```

### Configure Smyth Vault (Local Dev)

Create a vault file in one of these locations:

-   `~/.smyth/.sre/vault.json` (recommended)
-   `./.smyth/.sre/vault.json` (project-local)

Minimal content example:

```json
{
    "default": {
        "openai": "sk-xxxxxx-Your-OpenAI-API-Key",
        "anthropic": "",
        "googleai": "",
        "groq": "",
        "togetherai": ""
    }
}
```

### Build and Run

```bash
npm run build
npm start
```

On start, you’ll see an SSE MCP URL printed like:

```
Smyth Docker Commander
--------------------------------
This MCP can spawn a linux sandbox container using docker and run commands in it.
--------------------------------
MCP url:  http://127.0.0.1:PORT/mcp
```

Keep this process running; clients connect to that MCP URL.

## Using this as an MCP Server

MCP here stands for Model Context Protocol. This server exposes SSE endpoints for clients that support MCP.

Below are examples for configuring two popular clients: Claude Code and Gemini CLI.

### Configure in Claude Code (VS Code extension / Desktop)

Claude Code supports registering MCP servers. You can add this server either via settings UI/JSON (VS Code) or by editing the Claude Desktop config. The general configuration uses a command-based server (start our Node process) or an SSE server (connect to an existing URL). This project prints an SSE URL at runtime; both approaches are shown.

-   Command-based (Claude starts the server):

```json
{
    "mcpServers": {
        "smyth-docker-sandbox": {
            "command": "node",
            "args": ["D:/SmythOS/demo-agents/SmythDockerSandbox/dist/index.js"],
            "env": {
                "NODE_ENV": "production"
            }
        }
    }
}
```

-   SSE-based (connect to a running process): first run `npm start` to get the URL, then configure:

```json
{
    "mcpServers": {
        "smyth-docker-sandbox": {
            "type": "sse",
            "url": "http://127.0.0.1:PORT/mcp"
        }
    }
}
```

Common locations to edit configuration:

-   Claude Code (VS Code): Settings → search for `mcpServers` and edit in JSON
-   Claude Desktop config file paths:
    -   Windows: `%APPDATA%/Claude/claude_desktop_config.json`
    -   macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
    -   Linux: `~/.config/Claude/claude_desktop_config.json`

After updating settings, restart Claude Code/Desktop.

### Configure in Gemini CLI

Gemini CLI can also connect to MCP servers. Create or edit `settings.json` and add an entry for this server. You can either let Gemini CLI spawn the server via a command, or connect to the SSE URL of a server you’ve already started.

User-scoped config locations:

-   Linux/macOS: `~/.gemini/settings.json`
-   Windows: `C:/Users/<YOU>/.gemini/settings.json`

-   Command-based configuration:

```json
{
    "mcpServers": {
        "smyth-docker-sandbox": {
            "command": "node",
            "args": ["D:/SmythOS/demo-agents/SmythDockerSandbox/dist/index.js"],
            "env": {
                "NODE_ENV": "production"
            }
        }
    }
}
```

-   SSE-based configuration (connect to a running server):

```json
{
    "mcpServers": {
        "smyth-docker-sandbox": {
            "type": "sse",
            "url": "http://127.0.0.1:PORT/mcp"
        }
    }
}
```

Restart `gemini` after editing settings.

## Example Client Flows

Once the server is registered and connected, a client can orchestrate flows like:

1. Start a container

-   Call `SpawnContainer`
-   Wait a few seconds for readiness

2. Run a command

-   Call `SendTTYInput` with `ttyInput: "ls -la\r", wait_seconds: 3`
-   Or use `SendTTYInputWithEscapeSequences` for special key sequences

3. Read output

-   Call `GetScreenContent` to fetch the latest buffer

4. Stop

-   Call `StopAndDestroyContainer` to cleanly end the session

## Collaborative Terminal Interaction

One of the unique features of this MCP server is that it enables **collaborative terminal sessions**. While an AI client (Claude, Gemini, etc.) is interacting with the container through MCP calls, you can also directly interact with the same terminal session:

-   **Human Input**: Type directly in the terminal where the MCP server is running - your keystrokes go to the container
-   **AI Input**: The AI client sends commands via `SendTTYInput` or `SendTTYInputWithEscapeSequences`
-   **Shared Output**: Both human and AI see the same terminal output in real-time
-   **Coordination**: Use F12 to enter command mode for local control (HELP, STATUS, STOP commands)

This allows for powerful "pair programming" scenarios where you and the AI can work together on the same terminal session, taking turns or collaborating on complex tasks.

## Notes, Tips, and Limits

-   Docker must be running; otherwise the server will return a helpful error.
-   The output buffer is truncated to keep it manageable (last ~5–10k characters).
-   This script expects a TTY; if not in a TTY environment, it will exit early.
-   The terminal reserves two bottom lines for a status bar. Pressing F12 in the host terminal enters a command mode for local control during manual sessions.
-   Default image is `ubuntu:latest`; you can modify the image in `src/index.ts` when constructing `DockerExecutor`.
-   Both human and AI inputs are sent to the same container TTY stream, so coordination may be needed for complex interactions.

## Development

-   Build: `npm run build`
-   Start (built): `npm start`
-   Dev loop: `npm run dev`

## Planned Enhancements

These are possible enhancements that we may add in the future. If you find this MCP server useful, we'd love your contributions to help implement any of these features:

### Configuration & Flexibility

-   **Dynamic LLM Model Selection**: Pass the LLM model (currently hardcoded to `gpt-4o`) as a command-line argument or environment variable
-   **Client-Selectable Docker Images**: Allow MCP clients to specify which Docker image to use when spawning containers (currently defaults to `ubuntu:latest`)
-   **Configurable Buffer Size**: Make the output buffer size configurable instead of the current fixed ~5-10k character limit
-   **Custom Container Commands**: Support for custom startup commands beyond the default `/bin/bash`
-   **Standalone Agent Mode**: Allow docker commander to run as a standalone interactive agent without the need for a client like gemini-cli or claude-code. (This requires implementing a standalone CLI for the agent)

### Enhanced Container Management

-   **Multi-Container Support**: Ability to spawn and manage multiple containers simultaneously with unique identifiers
-   **Container Persistence**: Option to keep containers running between MCP sessions for long-running tasks
-   **Resource Limits**: Configure CPU, memory, and disk limits for spawned containers
-   **Volume Mounting**: Support for mounting host directories into containers for file sharing

### Improved User Experience

-   **Session Recording**: Record and replay terminal sessions for debugging and learning
-   **Container Templates**: Pre-configured container setups for common development environments (Node.js, Python, Go, etc.)
-   **Status Dashboard**: Web-based dashboard to monitor active containers and their resource usage
-   **Logging Enhancements**: Better structured logging with different verbosity levels

### Security & Networking

-   **Network Isolation**: Enhanced network security options for containers
-   **Authentication**: Optional authentication for MCP server access
-   **Port Forwarding**: Expose container ports to the host for web development scenarios

Contributions and feature requests are welcome! Please open an issue or submit a pull request if you'd like to help implement any of these enhancements.

## License

MIT
