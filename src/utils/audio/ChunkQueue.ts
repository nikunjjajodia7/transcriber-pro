import { DeviceDetection } from '../DeviceDetection';

export class ChunkQueue {
  queue: any;
  currentMemoryUsage: any;
  processingCount: any;
  paused: any;
  lastRejectReason: any;
  HIGH_WATERMARK: any;
  LOW_WATERMARK: any;
  deviceDetection: any;
  maxQueueSize: any;
  memoryLimit: any;
  onMemoryWarning: any;
  constructor(maxQueueSize: any, memoryLimit: any, onMemoryWarning: any) {
    this.queue = [];
    // in bytes
    this.currentMemoryUsage = 0;
    this.processingCount = 0;
    this.paused = false;
    this.lastRejectReason = null;
    this.HIGH_WATERMARK = 0.8;
    this.LOW_WATERMARK = 0.5;
    this.deviceDetection = DeviceDetection.getInstance();
    const options = this.deviceDetection.getOptimalStreamingOptions();
    this.maxQueueSize = maxQueueSize || options.maxQueueSize;
    this.memoryLimit = (memoryLimit || options.memoryLimit) * 1024 * 1024;
    this.onMemoryWarning = onMemoryWarning;
  }
  async enqueue(chunk: any, metadata: any) {
    const rejectReason = this.getRejectReason(chunk.size);
    if (rejectReason) {
      this.lastRejectReason = rejectReason;
      this.paused = true;
      if (this.onMemoryWarning) {
        this.onMemoryWarning(this.getMemoryUsagePercent());
      }
      return false;
    }
    this.lastRejectReason = null;
    this.queue.push({ chunk, metadata });
    this.currentMemoryUsage += chunk.size;
    if (this.shouldPause()) {
      this.paused = true;
    }
    return true;
  }
  dequeue() {
    const item = this.queue.shift();
    if (item) {
      this.currentMemoryUsage -= item.chunk.size;
      if (this.paused && this.shouldResume()) {
        this.paused = false;
        this.lastRejectReason = null;
      }
    }
    return item || null;
  }
  peek() {
    return this.queue[0] || null;
  }
  size() {
    return this.queue.length;
  }
  isEmpty() {
    return this.queue.length === 0;
  }
  isPaused() {
    return this.paused;
  }
  canAcceptChunk(chunkSize: any) {
    return this.getRejectReason(chunkSize) === null;
  }
  getLastRejectReason() {
    return this.lastRejectReason;
  }
  getBackpressureState() {
    return {
      paused: this.paused,
      reason: this.lastRejectReason,
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      memoryPercent: this.getMemoryUsagePercent()
    };
  }
  getRejectReason(chunkSize: any) {
    if (this.queue.length >= this.maxQueueSize) {
      return "queue_full";
    }
    if (this.currentMemoryUsage + chunkSize > this.memoryLimit) {
      return "memory_limit";
    }
    if (this.deviceDetection.isMemoryConstrained()) {
      return "system_memory_constrained";
    }
    return null;
  }
  shouldPause() {
    const queuePercent = this.queue.length / this.maxQueueSize;
    const memoryPercent = this.currentMemoryUsage / this.memoryLimit;
    return queuePercent >= this.HIGH_WATERMARK || memoryPercent >= this.HIGH_WATERMARK;
  }
  shouldResume() {
    const queuePercent = this.queue.length / this.maxQueueSize;
    const memoryPercent = this.currentMemoryUsage / this.memoryLimit;
    return queuePercent <= this.LOW_WATERMARK && memoryPercent <= this.LOW_WATERMARK;
  }
  getMemoryUsage() {
    return this.currentMemoryUsage;
  }
  getMemoryUsagePercent() {
    return this.currentMemoryUsage / this.memoryLimit * 100;
  }
  setProcessing(count: any) {
    this.processingCount = count;
  }
  getProcessingCount() {
    return this.processingCount;
  }
  // Clear all chunks and free memory
  clear() {
    for (const item of this.queue) {
      if (item.chunk && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(item.chunk);
        } catch (e) {
        }
      }
    }
    this.queue = [];
    this.currentMemoryUsage = 0;
    this.processingCount = 0;
    this.paused = false;
  }
  // Get all pending chunks (for error recovery)
  getAllPending() {
    return [...this.queue];
  }
  // Get stats for monitoring
  getStats() {
    return {
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      memoryUsage: this.currentMemoryUsage,
      memoryLimit: this.memoryLimit,
      memoryPercent: this.getMemoryUsagePercent(),
      isPaused: this.paused,
      processingCount: this.processingCount
    };
  }
}
