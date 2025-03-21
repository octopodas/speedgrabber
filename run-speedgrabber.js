#!/usr/bin/env node

/**
 * This is a wrapper script that runs SpeedGrabber in a child process
 * to completely isolate each run and prevent memory leaks between executions
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get all command line arguments except the script name
const args = process.argv.slice(2);

// Path to the main SpeedGrabber script
const speedGrabberPath = path.join(__dirname, 'index.js');

// Add --expose-gc flag to enable manual garbage collection
// and increase memory limit to 8GB with explicit new space size
const nodeArgs = [
  '--expose-gc',
  '--max-old-space-size=8192',
  '--max-semi-space-size=512',
  speedGrabberPath,
  ...args
];

console.log(`Running SpeedGrabber with Node.js flags: ${nodeArgs.slice(0, -args.length).join(' ')}`);

// Spawn a new Node.js process with increased memory limit
const child = spawn('node', nodeArgs, {
  stdio: 'inherit', // Pipe all stdio to the parent process
  env: { ...process.env, NODE_OPTIONS: '--no-warnings' } // Suppress warnings
});

// Handle process exit
child.on('close', (code) => {
  // Force garbage collection before exiting
  if (globalThis.gc) {
    try {
      globalThis.gc();
    } catch (e) {
      // Ignore errors
    }
  }
  process.exit(code);
});

// Handle process errors
child.on('error', (err) => {
  console.error(`Failed to start SpeedGrabber: ${err.message}`);
  process.exit(1);
});
