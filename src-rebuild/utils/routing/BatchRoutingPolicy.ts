class BatchRoutingPolicy {
  constructor(settings) {
    this.settings = settings;
  }
  decide(sourcePath, sizeBytes) {
    const sourceType = this.detectSourceType(sourcePath);
    const thresholdBytes = this.settings.batchChunkThresholdMB * 1024 * 1024;
    const isLargeUpload = sourceType === "uploaded" && sizeBytes > thresholdBytes;
    const backendEnabled = this.settings.enableBackendOrchestration;
    const prefersBackend = this.settings.preferBackendForLargeUploads;
    if (sourceType === "uploaded") {
      return {
        route: "backend_batch",
        preferredRoute: "backend_batch",
        sourceType,
        isLargeUpload,
        reason: backendEnabled ? "uploaded_cloud_route_enforced" : "uploaded_cloud_route_enforced_backend_disabled",
        backendEnabled
      };
    }
    return {
      route: "direct_batch",
      preferredRoute: "direct_batch",
      sourceType,
      isLargeUpload,
      reason: isLargeUpload ? "large_upload_backend_not_preferred" : "default_direct_batch",
      backendEnabled
    };
  }
  detectSourceType(sourcePath) {
    if (!sourcePath)
      return "unknown";
    const normalized = sourcePath.toLowerCase();
    const recordingRoot = this.settings.recordingFolderPath.trim().toLowerCase();
    if (recordingRoot.length > 0 && normalized.startsWith(`${recordingRoot}/`)) {
      return "recorded";
    }
    return "uploaded";
  }
}
