import * as readline from 'readline';

/**
 * Interactively prompts user for confirmation [y/N].
 */
export async function promptConfirm(question: string, defaultYes = false): Promise<boolean> {
  // If not a TTY (running in CI or piped), fallback to default
  if (!process.stdin.isTTY) {
    return defaultYes;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';

  return new Promise((resolve) => {
    rl.question(question + suffix, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) {
        resolve(defaultYes);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Securely prompts for input with hidden/masked typing (for PAT).
 */
export async function promptSecure(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // In non-interactive mode, try reading a single line
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  return new Promise((resolve) => {
    process.stdout.write(question);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let input = '';

    // Handle keypress to avoid echoing characters
    const onData = (char: Buffer) => {
      const str = char.toString('utf-8');
      if (str === '\n' || str === '\r' || str === '\u0004') {
        // enter or EOF
        cleanup();
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (str === '\u0003') {
        // Ctrl+C
        cleanup();
        process.exit(130);
      } else if (str === '\u0008' || str === '\x7f') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += str;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}
