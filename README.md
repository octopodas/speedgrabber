# SpeedGrabber

A high-performance tool for recursively scanning directories, analyzing file statistics, and efficiently uploading files to Amazon S3. Built with Node.js for maximum speed and memory efficiency.

## Features

- **Fast Directory Scanning**: Efficiently scans directories with millions of files
- **Multi-threaded Processing**: Uses worker threads for parallel processing
- **S3 Integration**: Uploads files to Amazon S3 with configurable concurrency
- **Memory Optimization**: Includes garbage collection and memory management features
- **Progress Reporting**: Real-time progress indicators for long-running operations
- **Detailed Statistics**: Provides comprehensive file and directory statistics
- **Selective Uploads**: Option to check if files exist in S3 before uploading

## Installation

### Prerequisites

- Node.js 16.x or higher
- AWS CLI installed and configured with appropriate credentials
- Permissions to access the target S3 bucket

### Global Installation

```bash
npm install -g speedgrabber
```

### Local Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/speedgrabber.git
cd speedgrabber

# Install dependencies
npm install

# Make the wrapper script executable
chmod +x run-speedgrabber.js
```

## Usage

```bash
speedgrabber [options] <directory>
```

### Arguments

- `directory`: Target directory to scan (required)

### Options

- `-v, --verbose`: Display detailed information about each file
- `-w, --workers <number>`: Number of worker threads to use
- `-p, --progress`: Show progress during scan
- `-u, --upload`: Upload files to S3 after scanning
- `-b, --bucket <n>`: S3 bucket name for upload
- `-c, --concurrent <number>`: Number of concurrent uploads (default: 5)
- `--checkExist`: Check if files exist in S3 before uploading
- `-h, --help`: Display help information
- `-V, --version`: Display version information

### Examples

```bash
# Basic scan
speedgrabber /path/to/directory

# Scan with progress indicator
speedgrabber /path/to/directory --progress

# Scan with detailed file information
speedgrabber /path/to/directory --verbose

# Upload files to S3
speedgrabber /path/to/directory --upload --bucket my-bucket

# Customize concurrent uploads
speedgrabber /path/to/directory --upload --bucket my-bucket --concurrent 10 --progress

# Scan and upload only files that don't exist in S3 yet
speedgrabber /path/to/directory --upload --bucket my-bucket --checkExist
```

## Memory Optimization

When scanning large directories or processing a large number of files, you may need to increase Node.js memory limit to avoid "JavaScript heap out of memory" errors. SpeedGrabber provides two ways to handle memory issues:

### 1. Using the Wrapper Script (Recommended)

The recommended approach is to use the included wrapper script, which runs each SpeedGrabber operation in an isolated process:

```bash
# Use the wrapper script directly
./run-speedgrabber.js /path/to/directory --upload --bucket my-bucket --progress

# Or if installed globally
speedgrabber /path/to/directory --upload --bucket my-bucket --progress
```

This wrapper script automatically sets the following Node.js flags:
- `--expose-gc`: Enables manual garbage collection
- `--max-old-space-size=8192`: Sets 8GB memory limit
- `--max-semi-space-size=512`: Optimizes garbage collection

### 2. Manual Memory Allocation

Alternatively, you can manually set the Node.js memory limit:

```bash
# Increase Node.js memory limit to 4GB
node --max-old-space-size=4096 index.js /path/to/large/directory --upload --bucket my-bucket --progress

# Or if installed globally
node --max-old-space-size=4096 $(which speedgrabber) /path/to/large/directory --upload --bucket my-bucket
```

Adjust the value (4096 = 4GB) based on your system's available memory.

### Troubleshooting Memory Issues

If you encounter persistent memory issues even with increased memory limits:

1. Avoid running multiple large operations in the same terminal session
2. Process smaller directories separately instead of one large directory
3. Use the wrapper script which isolates each run in a separate process
4. Restart your terminal session between large operations
5. Reduce the number of concurrent uploads with the `-c` parameter

## S3 Upload Features

### Concurrent Uploads

SpeedGrabber supports configurable concurrent uploads to maximize throughput:

```bash
# Upload with 20 concurrent connections
speedgrabber /path/to/directory --upload --bucket my-bucket --concurrent 20
```

### Selective Uploads

To avoid re-uploading existing files, use the `--checkExist` flag:

```bash
# Only upload files that don't exist in the bucket
speedgrabber /path/to/directory --upload --bucket my-bucket --checkExist
```

This option checks if each file already exists in S3 before uploading, which can save bandwidth and time for incremental uploads.

## File Structure

Each file in the scan results contains the following information:

- `filepath`: The absolute path to the file
- `size`: File size in bytes
- `status`: Current status of the file (ready, transfer, done, failed)
- `error`: Error message if upload failed

## License

MIT
