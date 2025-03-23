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
    const childProcess = exec(command, { ...options, maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
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
 * Check if a directory exists in S3
 * @param {string} s3Path - S3 path to check
 * @returns {Promise<boolean>} - Whether the directory exists
 */
async function checkDirectoryExistsInS3(s3Path) {
  try {
    // Extract bucket and key from s3 path
    // s3Path format: s3://bucket-name/path/to/directory/
    const s3PathParts = s3Path.replace('s3://', '').split('/');
    const bucketName = s3PathParts.shift();
    const prefix = s3PathParts.join('/') + '/';
    
    // Use aws s3api list-objects to check if directory exists (has any objects)
    const command = `aws s3api list-objects --bucket "${bucketName}" --prefix "${prefix}" --max-items 1`;
    const result = await execAsync(command, { timeout: 10000 });
    
    // If we get any results, the directory exists
    return result.stdout && result.stdout.trim().length > 0;
  } catch (error) {
    // If the command fails, assume the directory doesn't exist
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
    const command = `aws s3 cp "${file.filepath}" "${s3Path}"`;
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
 * Upload a directory to S3
 * @param {object} folder - Folder object with path, fileCount and totalSize properties
 * @param {string} bucketName - S3 bucket name
 * @param {string} basePath - Base directory path for relative path calculation
 * @param {boolean} verbose - Whether to show detailed output
 * @returns {Promise<object>} - Result with success status and bytes uploaded
 */
export async function uploadDirectoryToS3(folder, bucketName, basePath, verbose = false) {
  const result = {
    success: false,
    bytesUploaded: 0,
    status: 'transfer'
  };
  
  try {
    // Calculate the S3 path (preserve directory structure)
    const relativePath = path.relative(basePath, folder.path);
    const s3Path = `s3://${bucketName}/${relativePath}`;
    const folderName = path.basename(folder.path);
    
    // Print verbose information if requested
    if (verbose) {
      console.log(`${chalk.blue('Uploading directory:')} ${chalk.cyan(folderName)} ${chalk.gray('→')} ${chalk.yellow(s3Path)} (${formatSize(folder.totalSize)}, ${folder.fileCount} files)`);
    }
    
    // Execute AWS CLI command to upload the directory with a timeout
    // Use --recursive flag to upload the entire directory
    const command = `aws s3 cp "${folder.path}" "${s3Path}" --recursive`;
    await execAsync(command, { timeout: 300000, maxBuffer: 100 * 1024 * 1024 }); // 5 minute timeout per directory with 100MB buffer
    
    // Update result
    result.status = 'done';
    result.success = true;
    result.bytesUploaded = folder.totalSize;
    return result;
  } catch (error) {
    // Update result to failed
    result.status = 'failed';
    result.error = error.message;
    
    // Print error in verbose mode
    if (verbose) {
      console.log(`${chalk.red('Failed directory:')} ${chalk.cyan(path.basename(folder.path))} - ${chalk.red(error.message)}`);
    }
    
    return result;
  }
}

/**
 * Manage the upload process for directories
 * @param {object} fileStructure - FileStructure instance with folders to upload
 * @param {string} bucketName - S3 bucket name
 * @param {string} basePath - Base directory path for relative path calculation
 * @param {number} maxConcurrent - Maximum number of concurrent uploads
 * @param {object} options - Upload options
 * @param {boolean} options.progress - Whether to show progress during upload
 * @param {boolean} options.verbose - Whether to show detailed output
 * @returns {Promise<void>}
 */
export async function uploadFilesToS3(fileStructure, bucketName, basePath, maxConcurrent, options) {
  // We'll only use the first-level folders for uploading
  const folders = fileStructure.firstLevelFolders;
  const totalFolders = folders.length;
  let completedUploads = 0;
  let lastProgressUpdate = Date.now();
  const progressInterval = 1000; // Update progress every second
  const showProgress = options?.progress || false;
  const verbose = options?.verbose || false;
  
  // Upload statistics
  let totalBytesUploaded = 0;
  const uploadStartTime = Date.now();
  
  // Ensure maxConcurrent is a number and has a reasonable default
  const concurrentUploads = typeof maxConcurrent === 'number' && maxConcurrent > 0 ? maxConcurrent : 5;
  console.log(`Using concurrent uploads: ${concurrentUploads} (maxConcurrent value received: ${maxConcurrent}, type: ${typeof maxConcurrent})`);
  
  // Create a queue of folders to upload
  const uploadQueue = [...folders];
  
  // Track upload status for each folder
  const folderStatus = {
    ready: totalFolders,
    transfer: 0,
    done: 0,
    failed: []
  };
  
  // Function to process the next batch of uploads
  async function processUploads() {
    if (uploadQueue.length === 0) return;
    
    const batch = [];
    const batchSize = Math.min(concurrentUploads, uploadQueue.length);
    
    console.log(`Processing batch of ${batchSize} directories, ${uploadQueue.length} remaining in queue`);
    
    for (let i = 0; i < batchSize; i++) {
      if (uploadQueue.length > 0) {
        const folder = uploadQueue.shift();
        if (folder) {
          folderStatus.ready--;
          folderStatus.transfer++;
          
          batch.push(
            uploadDirectoryToS3(folder, bucketName, basePath, verbose)
              .then((result) => {
                completedUploads++;
                folderStatus.transfer--;
                
                // Update total bytes uploaded for successful uploads
                if (result.success && result.status === 'done') {
                  totalBytesUploaded += result.bytesUploaded;
                  folderStatus.done++;
                } else if (result.status === 'failed') {
                  folderStatus.failed.push(folder.path);
                }
                
                // Show progress if enabled and not in verbose mode (to avoid cluttering output)
                if (showProgress && !verbose) {
                  const now = Date.now();
                  if (now - lastProgressUpdate > progressInterval) {
                    const percent = Math.round((completedUploads / totalFolders) * 100);
                    process.stdout.write(`\rUploading: ${completedUploads}/${totalFolders} directories (${percent}%)`);
                    lastProgressUpdate = now;
                  }
                }
              })
              .catch(err => {
                console.error(`Unexpected error during upload: ${err.message}`);
                completedUploads++;
                folderStatus.transfer--;
                folderStatus.failed.push(folder.path);
              })
          );
        }
      }
    }
    
    try {
      // Wait for the current batch to complete with a timeout
      const batchTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Batch upload timeout')), 600000); // 10 minute timeout for batch
      });
      
      await Promise.race([
        Promise.all(batch),
        batchTimeout
      ]);
      
      console.log(`Batch completed, ${completedUploads}/${totalFolders} directories processed`);
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
  console.log(chalk.blue(`Total directories to upload: ${totalFolders}`));
  
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
  
  // Display results
  console.log(chalk.green('\nUpload completed!'));
  console.log(chalk.yellow('Upload Statistics:'));
  console.log(`Directories ready: ${chalk.bold(folderStatus.ready)}`);
  console.log(`Directories in transfer: ${chalk.bold(folderStatus.transfer)}`);
  console.log(`Directories uploaded successfully: ${chalk.bold(folderStatus.done)}`);
  console.log(`Directories failed: ${chalk.bold(folderStatus.failed.length)}`);
  console.log(`Total data uploaded: ${chalk.bold(formatSize(totalBytesUploaded))}`);
  console.log(`Average upload rate: ${chalk.bold(uploadRateMBps.toFixed(2))} MB/sec`);
  console.log(`Upload time: ${chalk.bold(uploadTimeSeconds.toFixed(2))} seconds`);
  
  // Display failed directories if any
  if (folderStatus.failed.length > 0) {
    console.log(chalk.red('\nFailed uploads:'));
    folderStatus.failed.forEach(filepath => {
      console.log(`  ${chalk.red('×')} ${filepath}`);
    });
  }
}
