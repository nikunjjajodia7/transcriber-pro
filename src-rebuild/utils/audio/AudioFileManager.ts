import { ensureDirectoryExists, saveAudioFile } from '../FileUtils';

export class AudioFileManager {
  constructor(plugin) {
    this.plugin = plugin;
  }
  /**
   * Saves an audio blob to the configured recordings folder with a unique name
   * @param audioBlob The audio data to save
   * @returns Path to the saved audio file
   */
  async saveAudioFile(audioBlob) {
    const folderPath = this.plugin.settings.recordingFolderPath || "";
    await ensureDirectoryExists(this.plugin.app, folderPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseFileName = `recording-${timestamp}.webm`;
    let fileName = baseFileName;
    let filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    let count = 1;
    while (await this.plugin.app.vault.adapter.exists(filePath)) {
      fileName = `recording-${timestamp}-${count}.webm`;
      filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
      count++;
    }
    try {
      const file = await saveAudioFile(
        this.plugin.app,
        audioBlob,
        fileName,
        this.plugin.settings
      );
      if (!file) {
        throw new Error("Failed to create audio file");
      }
      return file.path;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to save audio file: ${message}`);
    }
  }
  /**
   * Removes temporary chunk files after processing is complete
   * @param paths Array of file paths to remove
   */
  async removeTemporaryFiles(paths) {
    for (const path of paths) {
      try {
        await this.plugin.app.vault.adapter.remove(path);
      } catch (error) {
      }
    }
  }
}
