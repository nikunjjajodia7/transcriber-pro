export class DeviceDetection {
  constructor() {
    this.availableMemory = null;
    this.isMobileDevice = this.detectMobile();
    this.updateMemoryInfo();
  }
  static getInstance() {
    if (!this.instance) {
      this.instance = new DeviceDetection();
    }
    return this.instance;
  }
  detectMobile() {
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileKeywords = ["mobile", "tablet", "android", "iphone", "ipad", "ipod"];
    const isMobileUA = mobileKeywords.some((keyword) => userAgent.includes(keyword));
    const isSmallScreen = window.innerWidth <= 768 || window.innerHeight <= 768;
    const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const mobileIndicators = [isMobileUA, isSmallScreen, hasTouch];
    const mobileCount = mobileIndicators.filter(Boolean).length;
    return mobileCount >= 2;
  }
  updateMemoryInfo() {
    if ("memory" in performance && performance.memory) {
      const memoryInfo = performance.memory;
      this.availableMemory = memoryInfo.jsHeapSizeLimit - memoryInfo.usedJSHeapSize;
    } else {
      this.availableMemory = this.isMobileDevice ? 512 * 1024 * 1024 : (
        // 512MB for mobile
        2048 * 1024 * 1024
      );
    }
  }
  isMobile() {
    return this.isMobileDevice;
  }
  getAvailableMemory() {
    this.updateMemoryInfo();
    return this.availableMemory || 0;
  }
  getOptimalStreamingOptions() {
    const isMobile = this.isMobile();
    const availableMemory = this.getAvailableMemory();
    if (isMobile || availableMemory < 1024 * 1024 * 1024) {
      return {
        chunkDuration: 5,
        // 5 second chunks
        maxQueueSize: 3,
        // Max 3 chunks in memory
        bitrate: 16e3,
        // 16kbps
        processingMode: "streaming",
        memoryLimit: 100
        // 100MB limit
      };
    } else {
      return {
        chunkDuration: 10,
        // 10 second chunks
        maxQueueSize: 5,
        // Max 5 chunks in memory
        bitrate: 48e3,
        // 48kbps
        processingMode: "streaming",
        memoryLimit: 300
        // 300MB limit
      };
    }
  }
  shouldUseStreamingMode() {
    return this.isMobile() || this.getAvailableMemory() < 1024 * 1024 * 1024;
  }
  getRecommendedBitrate() {
    return this.isMobile() ? 16e3 : 48e3;
  }
  getRecommendedSampleRate() {
    return this.isMobile() ? 16e3 : 44100;
  }
  // Memory pressure check
  isMemoryConstrained() {
    const available = this.getAvailableMemory();
    const threshold = this.isMobile() ? 50 * 1024 * 1024 : 200 * 1024 * 1024;
    return available < threshold;
  }
}
