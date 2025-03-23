#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { isMainThread } from 'worker_threads';

// Import modules
import { FileStructure } from './fileStructure.js';
import { scanDirectoryParallel } from './scanner.js';
import { uploadFilesToS3 } from './uploader.js';
import { formatSize } from './utils.js';

// Set up the command line interface
if (isMainThread) {
  const program = new Command();

  program
    .name('speedgrabber')
    .description('A tool to recursively scan directories and provide file statistics')
    .version('1.0.0')
    .argument('<directory>', 'Target directory to scan')
    .option('-v, --verbose', 'Display detailed information about each file')
    .option('-w, --workers <number>', 'Number of worker threads to use', parseInt)
    .option('-p, --progress', 'Show progress during scan')
    .option('-u, --upload', 'Upload files to S3 after scanning')
    .option('-b, --bucket <name>', 'S3 bucket name for upload')
    .option('-c, --concurrent <number>', 'Number of concurrent uploads', (val) => parseInt(val, 10) || 5)
    .option('--checkExist', 'Check if files exist in S3 before uploading')
    .action(async (directory, options) => {
      const targetDir = path.resolve(directory);
      
      try {
        // Check if directory exists
        const stats = await fs.promises.stat(targetDir);
        if (!stats.isDirectory()) {
          console.error(chalk.red(`Error: ${targetDir} is not a directory`));
          process.exit(1);
        }
        
        console.log(chalk.blue(`Starting scan of ${targetDir}...`));
        
        const fileStructure = new FileStructure();
        // Always store files if upload is needed
        if (options.verbose || options.upload) {
          fileStructure.enableFileStorage();
        }
        
        const startTime = Date.now();
        
        // Use parallel scanning with worker threads
        await scanDirectoryParallel(targetDir, fileStructure, {
          workers: options.workers,
          showProgress: options.progress
        });
        
        const endTime = Date.now();
        const statistics = fileStructure.getStatistics();
        
        // Display results
        console.log(chalk.green('\nScan completed!'));
        console.log(chalk.yellow('Statistics:'));
        console.log(`Total files: ${chalk.bold(statistics.totalFiles.toLocaleString())}`);
        console.log(`Total size: ${chalk.bold(formatSize(statistics.totalSize))}`);
        console.log(`Directories processed: ${chalk.bold(statistics.processedDirs.toLocaleString())}`);
        console.log(`Scan time: ${chalk.bold((endTime - startTime) / 1000)} seconds`);
        
        // Display first-level folder substructure
        if (statistics.firstLevelFolders && statistics.firstLevelFolders.length > 0) {
          console.log(chalk.yellow(`\nFolder structure inside '${statistics.rootDirName}':`));
          statistics.firstLevelFolders.forEach(folder => {
            const folderName = path.basename(folder.path);
            console.log(`${chalk.cyan(folderName)} - ${chalk.bold(folder.fileCount.toLocaleString())} files - ${chalk.bold(formatSize(folder.totalSize))}`);
          });
        }
        
        if (options.verbose) {
          console.log(chalk.yellow('\nDetailed file listing:'));
          statistics.files.forEach(file => {
            console.log(`${chalk.cyan(file.filepath)} - ${formatSize(file.size)} - Status: ${file.status}`);
          });
        }
        
        // Upload files to S3 if requested
        if (options.upload) {
          if (!options.bucket) {
            console.error(chalk.red('Error: S3 bucket name is required for upload. Use --bucket option.'));
            process.exit(1);
          }
          
          // Force garbage collection before upload if available
          if (typeof globalThis.gc === 'function') {
            try {
              console.log(chalk.blue('Running garbage collection before upload...'));
              globalThis.gc();
            } catch (e) {
              // Ignore errors if gc is not available
            }
          }
          
          // Upload files to S3
          console.log(`Debug: Concurrent parameter value: ${options.concurrent}, type: ${typeof options.concurrent}`);
          await uploadFilesToS3(
            fileStructure,
            options.bucket,
            targetDir,
            options.concurrent,
            { progress: options.progress, verbose: options.verbose, checkExist: options.checkExist }
          );
          
          // Clear files from memory after upload is complete
          fileStructure.clearFiles();
          
          // Force garbage collection after upload if available
          if (typeof globalThis.gc === 'function') {
            try {
              console.log(chalk.blue('Running garbage collection after upload...'));
              globalThis.gc();
            } catch (e) {
              // Ignore errors if gc is not available
            }
          }
          
          // Explicitly exit the process after upload is complete
          console.log(chalk.green('SpeedGrabber completed successfully.'));
          process.exit(0);
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  program.parse(process.argv);
}
