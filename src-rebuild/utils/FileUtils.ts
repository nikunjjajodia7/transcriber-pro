import { TFolder } from 'obsidian';

export async function ensureDirectoryExists(app, folderPath) {
  const normalizedPath = folderPath.replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) {
    return "";
  }
  const parts = normalizedPath.split("/");
  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folder = app.vault.getAbstractFileByPath(currentPath);
    if (!folder) {
      await app.vault.createFolder(currentPath);
    } else if (!(folder instanceof TFolder)) {
      throw new Error(`Path "${currentPath}" exists but is not a folder`);
    }
  }
  return normalizedPath;
}
export async function saveAudioFile(app, audioBlob, fileName, settings) {
  const folderPath = settings.recordingFolderPath || "";
  const normalizedFolder = await ensureDirectoryExists(app, folderPath);
  const filePath = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
  const arrayBuffer = await audioBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const file = await app.vault.createBinary(filePath, uint8Array);
  if (!file) {
    throw new Error(`Failed to create audio file: ${filePath}`);
  }
  return file;
}
