/**
 * File structure class to manage file information and statistics
 */
export class FileStructure {
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
  
  // Clear all files to free up memory
  clearFiles() {
    this.files = [];
  }
}
