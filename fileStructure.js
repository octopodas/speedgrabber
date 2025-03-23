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
    this.firstLevelFolders = []; // Array to store first level folders
    this.rootDirName = ''; // Store the root directory name
  }

  // Set the root directory name (leaf segment of the supplied path)
  setRootDirName(rootDirName) {
    this.rootDirName = rootDirName;
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

  addFirstLevelFolder(folderPath, fileCount = 0, totalSize = 0) {
    // Check if folder already exists
    const existingIndex = this.firstLevelFolders.findIndex(f => f.path === folderPath);
    
    if (existingIndex >= 0) {
      // Update existing folder
      this.firstLevelFolders[existingIndex].fileCount += fileCount;
      this.firstLevelFolders[existingIndex].totalSize += totalSize;
    } else {
      // Add new folder
      this.firstLevelFolders.push({
        path: folderPath,
        fileCount: fileCount,
        totalSize: totalSize
      });
    }
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
      processedDirs: this.processedDirs,
      firstLevelFolders: this.firstLevelFolders,
      rootDirName: this.rootDirName
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
