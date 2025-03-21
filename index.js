#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import chalk from 'chalk';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

// Promisify exec for async/await usage
const execAsync = promisify(exec);

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the file structure class
class FileStructure {
  constructor() {
    this.files = [];
    this.totalSize = 0;
    this.totalFiles = 0;
    this.processedDirs = 0;
    this.storeFiles = true; // Always store files if upload is needed
  }

  addFile(filepath, size) {
    if (this.storeFiles) {
      this.files.push({
        filepath,
        size,
        status: 'ready'
      });
    }
    this.totalSize += size;
    this.totalFiles += 1;
  }

  addBatch(filesBatch) {
    for (const file of filesBatch) {
      if (this.storeFiles) {
        this.files.push(file);
      }
      this.totalSize += file.size;
    }
    this.totalFiles += filesBatch.length;
  }

  incrementProcessedDirs(count = 1) {
    this.processedDirs += count;
  }

  getStatistics() {
    return {
      totalFiles: this.totalFiles,
      totalSize: this.totalSize,
      files: this.files,
      processedDirs: this.processedDirs
    };
  }

  enableFileStorage() {
    this.storeFiles = true;
  }

  // Get upload statistics
  getUploadStatistics() {
    const statusCounts = {
      ready: 0,
      transfer: 0,
      done: 0,
      failed: []
    };

    for (const file of this.files) {
      if (file.status === 'failed') {
        statusCounts.failed.push(file.filepath);
      } else {
        statusCounts[file.status] = (statusCounts[file.status] || 0) + 1;
      }
    }

    return statusCounts;
  }
}

// Function to upload a single file to S3
async function uploadFileToS3(file, bucketName, basePath, verbose) {
  // Update file status to 'transfer'
  file.status = 'transfer';
  
  try {
    // Calculate the S3 path (preserve directory structure)
    const relativePath = path.relative(basePath, file.filepath);
    const s3Path = `s3://${bucketName}/${relativePath}`;
    
    // Print verbose information if requested
    if (verbose) {
      console.log(`${chalk.blue('Uploading:')} ${chalk.cyan(file.filepath)} ${chalk.gray('→')} ${chalk.yellow(s3Path)} (${formatSize(file.size)})`);
    }
    
    // Execute AWS CLI command to upload the file
    await execAsync(`aws s3 cp "${file.filepath}" "${s3Path}"`);
    
    // Update file status to 'done'
    file.status = 'done';
    return true;
  } catch (error) {
    // Update file status to 'failed'
    file.status = 'failed';
    file.error = error.message;
    
    // Print error in verbose mode
    if (verbose) {
      console.log(`${chalk.red('Failed:')} ${chalk.cyan(file.filepath)} - ${chalk.red(error.message)}`);
    }
    
    return false;
  }
}

// Function to manage the upload process
async function uploadFilesToS3(fileStructure, bucketName, basePath, maxConcurrent, options) {
  const files = fileStructure.files;
  const totalFiles = files.length;
  let completedUploads = 0;
  let lastProgressUpdate = Date.now();
  const progressInterval = 1000; // Update progress every second
  const showProgress = options.progress;
  const verbose = options.verbose;
  
  // Upload statistics
  let totalBytesUploaded = 0;
  const uploadStartTime = Date.now();
  
  // Create a queue of files to upload
  const uploadQueue = [...files];
  
  // Function to process the next batch of uploads
  async function processUploads() {
    if (uploadQueue.length === 0) return;
    
    const batch = [];
    const batchSize = Math.min(maxConcurrent, uploadQueue.length);
    
    for (let i = 0; i < batchSize; i++) {
      if (uploadQueue.length > 0) {
        const file = uploadQueue.shift();
        if (file.status === 'ready') {
          batch.push(uploadFileToS3(file, bucketName, basePath, verbose).then(() => {
            completedUploads++;
            
            // Update total bytes uploaded for successful uploads
            if (file.status === 'done') {
              totalBytesUploaded += file.size;
            }
            
            // Show progress if enabled and not in verbose mode (to avoid cluttering output)
            if (showProgress && !verbose) {
              const now = Date.now();
              if (now - lastProgressUpdate > progressInterval) {
                const percent = Math.round((completedUploads / totalFiles) * 100);
                process.stdout.write(`\rUploading: ${completedUploads}/${totalFiles} files (${percent}%)`);
                lastProgressUpdate = now;
              }
            }
          }));
        } else {
          // Skip files that are not in 'ready' status
          completedUploads++;
        }
      }
    }
    
    // Wait for the current batch to complete
    await Promise.all(batch);
    
    // Process the next batch
    if (uploadQueue.length > 0) {
      await processUploads();
    }
  }
  
  console.log(chalk.blue(`Starting upload to S3 bucket: ${bucketName}`));
  console.log(chalk.blue(`Total files to upload: ${totalFiles}`));
  
  // Start the upload process
  await processUploads();
  
  // Calculate upload time and rate
  const uploadEndTime = Date.now();
  const uploadTimeSeconds = (uploadEndTime - uploadStartTime) / 1000;
  const uploadRateMBps = (totalBytesUploaded / 1024 / 1024) / uploadTimeSeconds;
  
  // Clear the progress line
  if (showProgress && !verbose) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }
  
  // Get upload statistics
  const uploadStats = fileStructure.getUploadStatistics();
  
  // Display results
  console.log(chalk.green('\nUpload completed!'));
  console.log(chalk.yellow('Upload Statistics:'));
  console.log(`Files ready: ${chalk.bold(uploadStats.ready)}`);
  console.log(`Files in transfer: ${chalk.bold(uploadStats.transfer)}`);
  console.log(`Files uploaded successfully: ${chalk.bold(uploadStats.done)}`);
  console.log(`Files failed: ${chalk.bold(uploadStats.failed.length)}`);
  console.log(`Total data uploaded: ${chalk.bold(formatSize(totalBytesUploaded))}`);
  console.log(`Average upload rate: ${chalk.bold(uploadRateMBps.toFixed(2))} MB/sec`);
  console.log(`Upload time: ${chalk.bold(uploadTimeSeconds.toFixed(2))} seconds`);
  
  // Display failed files if any
  if (uploadStats.failed.length > 0) {
    console.log(chalk.red('\nFailed uploads:'));
    uploadStats.failed.forEach(filepath => {
      console.log(`  ${chalk.red('\u2717')} ${filepath}`);
    });
  }
}

// Worker thread code
if (!isMainThread) {
  const { dirPath } = workerData;
  const filesBatch = [];
  let processedDirs = 0;
  
  async function scanDirectoryWorker(dirPath) {
    try {
      processedDirs++;
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      // Process entries in batches
      const filesToProcess = [];
      const dirsToProcess = [];
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          dirsToProcess.push(fullPath);
        } else if (entry.isFile()) {
          filesToProcess.push(fullPath);
        }
      }
      
      // Get stats for all files in a batch
      if (filesToProcess.length > 0) {
        const statsPromises = filesToProcess.map(async (filePath) => {
          try {
            const stats = await fs.promises.stat(filePath);
            return { filepath: filePath, size: stats.size, status: 'ready' };
          } catch (error) {
            // Skip files with errors
            return null;
          }
        });
        
        const results = await Promise.all(statsPromises);
        filesBatch.push(...results.filter(Boolean));
      }
      
      // Process subdirectories
      const subDirPromises = dirsToProcess.map(dir => scanDirectoryWorker(dir));
      await Promise.all(subDirPromises);
      
    } catch (error) {
      // Skip directories with permission errors
    }
  }
  
  // Start scanning
  scanDirectoryWorker(dirPath).then(() => {
    parentPort.postMessage({ filesBatch, processedDirs });
  });
}

// Main thread function to recursively scan a directory using worker threads
async function scanDirectoryParallel(dirPath, fileStructure, options = {}) {
  const numWorkers = options.workers || Math.max(1, os.cpus().length - 1);
  
  // Function to get all immediate subdirectories
  async function getSubdirectories(dirPath) {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const dirs = [];
      
      // Add files in the root directory directly
      const rootFiles = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          dirs.push(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.promises.stat(fullPath);
            rootFiles.push({ filepath: fullPath, size: stats.size, status: 'ready' });
          } catch (error) {
            // Skip files with errors
          }
        }
      }
      
      // Add root files to the file structure
      if (rootFiles.length > 0) {
        fileStructure.addBatch(rootFiles);
      }
      
      return dirs;
    } catch (error) {
      console.error(chalk.red(`Error reading directory ${dirPath}: ${error.message}`));
      return [];
    }
  }
  
  // Get initial subdirectories
  fileStructure.incrementProcessedDirs(); // Count the root directory
  const initialDirs = await getSubdirectories(dirPath);
  
  // If there are no subdirectories, we're done
  if (initialDirs.length === 0) {
    return;
  }
  
  // Create a queue of directories to process
  const dirQueue = [...initialDirs];
  const activeWorkers = [];
  
  // Progress reporting
  let lastProgressUpdate = Date.now();
  const progressInterval = 1000; // Update progress every second
  
  // Function to create and manage workers
  function createWorker(workerDirPath) {
    return new Promise((resolve) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { dirPath: workerDirPath }
      });
      
      worker.on('message', (data) => {
        const { filesBatch, processedDirs } = data;
        
        // Add the batch of files to our structure
        if (filesBatch.length > 0) {
          fileStructure.addBatch(filesBatch);
        }
        
        // Update processed directories count
        fileStructure.incrementProcessedDirs(processedDirs);
        
        // Show progress if enough time has passed
        const now = Date.now();
        if (now - lastProgressUpdate > progressInterval) {
          if (options.showProgress) {
            process.stdout.write(`\rProcessed ${fileStructure.totalFiles.toLocaleString()} files (${formatSize(fileStructure.totalSize)})`);
          }
          lastProgressUpdate = now;
        }
        
        resolve();
      });
      
      worker.on('error', (err) => {
        console.error(chalk.red(`Worker error: ${err.message}`));
        resolve();
      });
    });
  }
  
  // Process directories with worker threads in batches
  while (dirQueue.length > 0) {
    // Create a batch of workers based on available CPU cores
    const batch = [];
    const batchSize = Math.min(numWorkers, dirQueue.length);
    
    for (let i = 0; i < batchSize; i++) {
      if (dirQueue.length > 0) {
        const nextDir = dirQueue.shift();
        batch.push(createWorker(nextDir));
      }
    }
    
    // Wait for all workers in this batch to complete
    await Promise.all(batch);
  }
  
  // Clear the progress line
  if (options.showProgress) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }
}

// Helper function to format file sizes
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

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
    .option('-c, --concurrent <number>', 'Number of concurrent uploads', parseInt, 5)
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
          
          // Upload files to S3
          await uploadFilesToS3(
            fileStructure,
            options.bucket,
            targetDir,
            options.concurrent,
            { progress: options.progress, verbose: options.verbose }
          );
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  program.parse(process.argv);
}
