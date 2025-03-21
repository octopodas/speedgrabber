# SpeedGrabber

A command-line tool to recursively scan directories, provide file statistics, and optionally upload files to AWS S3 buckets.

## Features

- Recursively scans a target directory
- Collects information about all files (path, size, status)
- Provides statistics (total files, total size)
- Supports verbose output for detailed file listings
- Uploads files to AWS S3 buckets with parallel processing
- Tracks upload progress and provides performance metrics

## Installation

### Local Installation

```bash
# Clone the repository
git clone <repository-url>
cd speedgrabber

# Install dependencies
npm install

# Make the tool globally available
npm link
```

### Global Installation (from npm)

```bash
npm install -g speedgrabber
```

## Usage

```bash
speedgrabber <directory> [options]
```

### Arguments

- `<directory>`: The target directory to scan (required)

### Options

- `-v, --verbose`: Display detailed information about each file and upload process
- `-w, --workers <number>`: Number of worker threads to use for scanning
- `-p, --progress`: Show progress during scan and upload
- `-u, --upload`: Upload files to S3 after scanning
- `-b, --bucket <name>`: S3 bucket name for upload
- `-c, --concurrent <number>`: Number of concurrent uploads (default: 5)
- `-h, --help`: Display help information
- `-V, --version`: Display version information

### Examples

```bash
# Scan the current directory
speedgrabber .

# Scan a specific directory with verbose output
speedgrabber /path/to/directory --verbose

# Scan and upload files to S3
speedgrabber /path/to/directory --upload --bucket my-bucket --progress

# Customize concurrent uploads
speedgrabber /path/to/directory --upload --bucket my-bucket --concurrent 10 --progress
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

This wrapper script automatically sets a 4GB memory limit and ensures complete memory cleanup between runs.

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

## Prerequisites for S3 Upload

- AWS CLI installed and configured with appropriate credentials
- Permissions to access the target S3 bucket

## File Structure

Each file in the scan results contains the following information:

- `filepath`: The absolute path to the file
- `size`: The size of the file in bytes
- `status`: The status of the file ('ready', 'transfer', 'done', or 'failed')

## License

ISC
