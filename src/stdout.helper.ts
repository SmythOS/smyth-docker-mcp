import * as tty from 'tty';
const stdout = process.stdout as tty.WriteStream;

// Method to update status - now handled internally
function updateStatus(message: string) {
    // Save current cursor position
    stdout.write('\x1b[s');

    // Move to bottom line
    stdout.write(`\x1b[${stdout.rows};1H`);

    // Clear the line
    stdout.write('\x1b[2K');

    // Write status message in cyan background with black text
    stdout.write(`\x1b[46m\x1b[30m Status: ${message} \x1b[0m`);

    // Restore cursor position
    stdout.write('\x1b[u');
}

// Method to clear status - now handled internally
function clearStatus() {
    // Save current cursor position
    stdout.write('\x1b[s');

    // Move to bottom line
    stdout.write(`\x1b[${stdout.rows};1H`);

    // Clear the line completely
    stdout.write('\x1b[2K');

    // Restore cursor position
    stdout.write('\x1b[u');
}

export { updateStatus, clearStatus, stdout };
