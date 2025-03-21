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
