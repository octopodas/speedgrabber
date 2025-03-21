// Simple script to show Node.js memory usage
import os from 'os';
import v8 from 'v8';

const formatMemoryUsage = (data) => {
  return Object.keys(data).map(key => {
    const memoryInMB = data[key] / 1024 / 1024;
    return `${key}: ${Math.round(memoryInMB * 100) / 100} MB`;
  }).join(' | ');
};

const printMemoryUsage = () => {
  const memoryData = process.memoryUsage();
  console.log(formatMemoryUsage(memoryData));
};

console.log('Memory usage at start:');
printMemoryUsage();

// Create a large array to simulate memory usage
const arr = [];
for (let i = 0; i < 1000000; i++) {
  arr.push({ index: i, data: `data-${i}`, moreData: new Array(10).fill(`item-${i}`) });
}

console.log('\nMemory usage after creating large array:');
printMemoryUsage();

// Force garbage collection if exposed
if (globalThis.gc) {
  console.log('\nRunning garbage collection...');
  globalThis.gc();
  console.log('Memory usage after garbage collection:');
  printMemoryUsage();
} else {
  console.log('\nGarbage collection not exposed. Run with --expose-gc flag to enable.');
}

// Memory limits
console.log('\nNode.js memory limits:');
console.log(`Total system memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`);
console.log(`Free system memory: ${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`);

// V8 heap statistics if available
try {
  console.log('\nV8 heap statistics:');
  console.log(v8.getHeapStatistics());
  
  // Heap space statistics
  console.log('\nV8 heap space statistics:');
  console.log(v8.getHeapSpaceStatistics());
} catch (e) {
  console.log('\nCould not get V8 statistics:', e.message);
}
