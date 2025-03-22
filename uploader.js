import { exec } from 'child_process';
import path from 'path';
import chalk from 'chalk';
import { formatSize } from './utils.js';

// Custom exec function with timeout and proper error handling
const execAsync = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    // Set a default timeout of 60 seconds
    const timeout = options.timeout || 60000;
    
    console.log(`Executing command: ${command}`);
    const childProcess = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command error: ${error.message}`);
        if (stderr) console.error(`stderr: ${stderr}`);
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    
    // Set a timeout to kill the process if it takes too long
    const timer = setTimeout(() => {
      childProcess.kill('SIGTERM');
      console.error(`Command timed out after ${timeout/1000} seconds: ${command}`);
      reject(new Error(`Command timed out after ${timeout/1000} seconds`));
    }, timeout);
    
    // Clear the timeout when the process completes
    childProcess.on('close', () => {
      clearTimeout(timer);
    });
  });
};

/**
 * Check if a file exists in S3
 * @param {string} s3Path - S3 path to check
 * @returns {Promise<boolean>} - Whether the file exists
 */
async function checkFileExistsInS3(s3Path) {
  try {
    // Extract bucket and key from s3 path
    // s3Path format: s3://bucket-name/path/to/file
    const s3PathParts = s3Path.replace('s3://', '').split('/');
    const bucketName = s3PathParts.shift();
    const objectKey = s3PathParts.join('/');
    
    // Use aws s3api head-object to check if file exists
    await execAsync(`aws s3api head-object --bucket "${bucketName}" --key "${objectKey}"`, { timeout: 10000 });
    return true;
  } catch (error) {
    // If the command fails with a 404, the file doesn't exist
    return false;
  }
}

/**
 * Upload a single file to S3
 * @param {object} file - File object with filepath, size and status properties
 * @param {string} bucketName - S3 bucket name
 * @param {string} basePath - Base directory path for relative path calculation
 * @param {boolean} verbose - Whether to show detailed output
 * @param {boolean} checkExist - Whether to check if file exists before uploading
 * @returns {Promise<boolean>} - Success status
 */
export async function uploadFileToS3(file, bucketName, basePath, verbose = false, checkExist = false) {
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
    
    // Check if file already exists in S3
    if (checkExist) {
      if (await checkFileExistsInS3(s3Path)) {
        console.log(`${chalk.green('Skipping:')} ${chalk.cyan(file.filepath)} ${chalk.gray('→')} ${chalk.yellow(s3Path)} (already exists)`); 
        file.status = 'done';
        return true;
      }
    }
    
    // Execute AWS CLI command to upload the file with a timeout
    const command = `aws s3 cp "${file.filepath}" "${s3Path}" --no-progress`;
    await execAsync(command, { timeout: 60000 }); // 60 second timeout per file
    
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

/**
 * Manage the upload process for multiple files
 * @param {object} fileStructure - FileStructure instance with files to upload
 * @param {string} bucketName - S3 bucket name
 * @param {string} basePath - Base directory path for relative path calculation
 * @param {number} maxConcurrent - Maximum number of concurrent uploads
 * @param {object} options - Upload options
 * @param {boolean} options.progress - Whether to show progress during upload
 * @param {boolean} options.verbose - Whether to show detailed output
 * @param {boolean} options.checkExist - Whether to check if file exists before uploading
 * @returns {Promise<void>}
 */
export async function uploadFilesToS3(fileStructure, bucketName, basePath, maxConcurrent, options) {
  const files = fileStructure.files;
  const totalFiles = files.length;
  let completedUploads = 0;
  let lastProgressUpdate = Date.now();
  const progressInterval = 1000; // Update progress every second
  const showProgress = options?.progress || false;
  const verbose = options?.verbose || false;
  const checkExist = options?.checkExist || false;
  
  // If checking for existing files, log it
  if (checkExist) {
    console.log(chalk.blue('Checking for existing files in S3 before uploading'));
  }
  
  // Upload statistics
  let totalBytesUploaded = 0;
  const uploadStartTime = Date.now();
  
  // Ensure maxConcurrent is a number and has a reasonable default
  const concurrentUploads = typeof maxConcurrent === 'number' && maxConcurrent > 0 ? maxConcurrent : 5;
  console.log(`Using concurrent uploads: ${concurrentUploads} (maxConcurrent value received: ${maxConcurrent}, type: ${typeof maxConcurrent})`);
  
  // Create a queue of files to upload
  const uploadQueue = [...files];
  
  // Function to process the next batch of uploads
  async function processUploads() {
    if (uploadQueue.length === 0) return;
    
    const batch = [];
    const batchSize = Math.min(concurrentUploads, uploadQueue.length);
    
    console.log(`Processing batch of ${batchSize} files, ${uploadQueue.length} remaining in queue`);
    
    for (let i = 0; i < batchSize; i++) {
      if (uploadQueue.length > 0) {
        const file = uploadQueue.shift();
        if (file && file.status === 'ready') {
          batch.push(
            uploadFileToS3(file, bucketName, basePath, verbose, checkExist)
              .then((success) => {
                completedUploads++;
                
                // Update total bytes uploaded for successful uploads
                if (success && file.status === 'done') {
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
                
                // Explicitly clear file data to free memory
                file.filepath = null;
                file.error = null;
              })
              .catch(err => {
                console.error(`Unexpected error during upload: ${err.message}`);
                completedUploads++;
              })
          );
        } else {
          // Skip files that are not in 'ready' status
          completedUploads++;
        }
      }
    }
    
    try {
      // Wait for the current batch to complete with a timeout
      const batchTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Batch upload timeout')), 180000); // 3 minute timeout for batch
      });
      
      await Promise.race([
        Promise.all(batch),
        batchTimeout
      ]);
      
      console.log(`Batch completed, ${completedUploads}/${totalFiles} files processed`);
    } catch (error) {
      console.error(`Batch error: ${error.message}`);
      // Continue with next batch even if this one failed
    }
    
    // Force garbage collection between batches (if globalThis.gc is available)
    if (typeof globalThis.gc === 'function') {
      try {
        console.log('Running garbage collection between batches...');
        globalThis.gc();
      } catch (e) {
        // Ignore errors if gc is not available
      }
    }
    
    // Process the next batch
    if (uploadQueue.length > 0) {
      // Use setImmediate to allow event loop to process other events
      // and potentially free up memory before processing next batch
      return new Promise(resolve => {
        setImmediate(async () => {
          await processUploads();
          resolve();
        });
      });
    }
  }
  
  console.log(chalk.blue(`Starting upload to S3 bucket: ${bucketName}`));
  console.log(chalk.blue(`Total files to upload: ${totalFiles}`));
  
  // Start the upload process
  await processUploads();
  
  // Calculate upload time and rate
  const uploadEndTime = Date.now();
  const uploadTimeSeconds = (uploadEndTime - uploadStartTime) / 1000;
  const uploadRateMBps = totalBytesUploaded > 0 ? (totalBytesUploaded / 1024 / 1024) / uploadTimeSeconds : 0;
  
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
      console.log(`  ${chalk.red('×')} ${filepath}`);
    });
  }
}
