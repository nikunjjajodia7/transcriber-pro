var import_obsidian6 = require("obsidian");

var _VideoProcessor = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.isProcessing = false;
  }
  static async getInstance(plugin) {
    if (!this.instance) {
      this.instance = new _VideoProcessor(plugin);
      await this.instance.initializeFFmpeg();
    }
    return this.instance;
  }
  async initializeFFmpeg() {
    this.ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
    });
  }
  async processVideo(file) {
    if (this.isProcessing) {
      throw new Error("Video processing is already in progress.");
    }
    try {
      this.isProcessing = true;
      new import_obsidian6.Notice("\u{1F3A5} Starting video processing...");
      const transcriptFile = await this.createTranscriptFile(file);
      const audioBuffer = await this.extractAudioFromVideo(file);
      const recordingProcessor = RecordingProcessor.getInstance(this.plugin);
      const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
      await recordingProcessor.processRecording(
        audioBlob,
        transcriptFile,
        { line: 0, ch: 0 },
        file.path
      );
      new import_obsidian6.Notice("\u2728 Video transcription completed");
      await this.plugin.app.workspace.getLeaf().openFile(transcriptFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      new import_obsidian6.Notice("\u274C Video processing failed: " + message);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }
  async createTranscriptFile(videoFile) {
    const baseName = videoFile.basename.replace(/[\\/:*?"<>|]/g, "");
    const fileName = `${baseName} - Video Transcript.md`;
    const folderPath = this.plugin.settings.transcriptFolderPath;
    if (folderPath) {
      const parts = folderPath.split("/").filter(Boolean);
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const folder = this.plugin.app.vault.getAbstractFileByPath(currentPath);
        if (!folder) {
          await this.plugin.app.vault.createFolder(currentPath);
        }
      }
    }
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    return this.plugin.app.vault.create(filePath, "");
  }
  async extractAudioFromVideo(file) {
    new import_obsidian6.Notice("\u{1F3B5} Extracting audio from video...");
    try {
      const videoData = await this.plugin.app.vault.readBinary(file);
      const videoBlob = new Blob([videoData], { type: this.getVideoMimeType(file.extension) });
      const videoURL = URL.createObjectURL(videoBlob);
      await this.ffmpeg.writeFile("input." + file.extension, await fetchFile(videoURL));
      await this.ffmpeg.exec([
        "-i",
        "input." + file.extension,
        "-vn",
        // No video
        "-acodec",
        "libmp3lame",
        // MP3 codec
        "-ab",
        "320k",
        // Bitrate
        "-ar",
        "44100",
        // Sample rate
        "-ac",
        "2",
        // Stereo
        "output.mp3"
        // Output file
      ]);
      const data = await this.ffmpeg.readFile("output.mp3");
      URL.revokeObjectURL(videoURL);
      await this.ffmpeg.deleteFile("input." + file.extension);
      await this.ffmpeg.deleteFile("output.mp3");
      return data.buffer;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      throw new Error("Failed to extract audio: " + message);
    }
  }
  getVideoMimeType(extension) {
    const mimeTypes = {
      "mp4": "video/mp4",
      "webm": "video/webm",
      "mov": "video/quicktime"
    };
    return mimeTypes[extension.toLowerCase()] || "video/mp4";
  }
};
var VideoProcessor = _VideoProcessor;
VideoProcessor.instance = null;
