import fs from 'fs';
import path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);

/**
 * Worker thread code for directory scanning
 * This is executed when the file is imported as a worker
 */
if (!isMainThread) {
  const { dirPath, rootDirName } = workerData;
  const filesBatch = [];
  let processedDirs = 0;
  
  // Track first-level folder statistics
  const folderStats = {};
  const rootDir = path.dirname(dirPath);
  
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
            
            // If this file belongs to a first-level folder, track its statistics
            const firstLevelParent = getFirstLevelParent(filePath, rootDir, rootDirName);
            
            if (firstLevelParent) {
              if (!folderStats[firstLevelParent]) {
                folderStats[firstLevelParent] = { fileCount: 0, totalSize: 0 };
              }
              folderStats[firstLevelParent].fileCount++;
              folderStats[firstLevelParent].totalSize += stats.size;
            }
            
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
  
  // Helper function to get the first level parent directory
  function getFirstLevelParent(filePath, rootDir, rootDirName) {
    // Get the path relative to the root directory
    const relativePath = path.relative(rootDir, filePath);
    const parts = relativePath.split(path.sep);
    
    // Check if the path contains the rootDirName and at least one more segment
    if (parts.length > 0 && parts[0] === rootDirName && parts.length > 1) {
      // Return the first-level folder path (rootDir/rootDirName/firstLevelFolder)
      return path.join(rootDir, rootDirName, parts[1]);
    }
    return null;
  }
  
  // Start scanning
  scanDirectoryWorker(dirPath).then(() => {
    parentPort.postMessage({ filesBatch, processedDirs, folderStats });
  });
}

/**
 * Main thread function to recursively scan a directory using worker threads
 * @param {string} dirPath - Directory to scan
 * @param {object} fileStructure - FileStructure instance to store results
 * @param {object} options - Scanning options
 * @param {number} options.workers - Number of worker threads to use
 * @param {boolean} options.showProgress - Whether to show progress during scan
 * @returns {Promise<void>}
 */
export async function scanDirectoryParallel(dirPath, fileStructure, options = {}) {
  const numWorkers = options.workers || Math.max(1, os.cpus().length - 1);
  
  // Extract the leaf segment of the directory path to use as the root
  const rootDirName = path.basename(dirPath);
  fileStructure.setRootDirName(rootDirName);
  
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
          
          // Add to first level folders with initial counts
          fileStructure.addFirstLevelFolder(fullPath, 0, 0);
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
        workerData: { dirPath: workerDirPath, rootDirName }
      });
      
      worker.on('message', (data) => {
        const { filesBatch, processedDirs, folderStats } = data;
        
        // Add the batch of files to our structure
        if (filesBatch.length > 0) {
          fileStructure.addBatch(filesBatch);
        }
        
        // Update processed directories count
        fileStructure.incrementProcessedDirs(processedDirs);
        
        // Update folder statistics
        for (const folder in folderStats) {
          fileStructure.addFirstLevelFolder(folder, folderStats[folder].fileCount, folderStats[folder].totalSize);
        }
        
        // Show progress if enough time has passed
        const now = Date.now();
        if (now - lastProgressUpdate > progressInterval) {
          if (options.showProgress) {
            process.stdout.write(`\rProcessed ${fileStructure.totalFiles.toLocaleString()} files (${formatSize(fileStructure.totalSize)})`);
          }
          lastProgressUpdate = now;
        }
        
        // Explicitly terminate the worker to free up resources
        worker.terminate();
        resolve();
      });
      
      worker.on('error', (err) => {
        console.error(chalk.red(`Worker error: ${err.message}`));
        // Ensure worker is terminated even on error
        worker.terminate();
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

// Import formatSize function for progress reporting
import { formatSize } from './utils.js';
