import { FileEncoding } from '@ext/shared/protocol';
import type { WebviewFileAttachment, WebviewImage } from '@ext/shared/protocol';

/** The result of staging a set of dropped/picked/pasted files. */
export interface StagedFiles {
  images: WebviewImage[];
  files: WebviewFileAttachment[];
  /** Names that couldn't be read at all (permissions, vanished mid-drop…). */
  rejected: string[];
}

/**
 * Heuristic binary sniff on the decoded text: NUL bytes never appear in real
 * text, and a high share of other control characters means the "text" is a
 * decoded binary (PDF, zip, xlsx…). Binaries still attach — as base64 the
 * host materializes to disk — they just don't go inline as prose.
 */
export function looksBinary(text: string): boolean {
  if (text.includes('\0')) return true;
  const sample = text.slice(0, 4096);
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    // Allow tab/newline/carriage-return; count other C0 controls and the
    // Unicode replacement character (a decode failure marker).
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 0xfffd
    ) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.05;
}

/** Encodes raw bytes to base64 in chunks (spread has an argument limit). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Reads an image File into the base64 form the wire expects (no `data:` URI
 * prefix). Resolves null if the file can't be read.
 */
export async function readImageFile(
  file: File
): Promise<{ mediaType: string; data: string } | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { mediaType: file.type || 'image/png', data: bytesToBase64(bytes) };
  } catch {
    return null;
  }
}

/**
 * Stages a mixed set of files for the composer — anything attaches:
 * - images become image blocks;
 * - text files become inline file-context attachments (no size cap — how much
 *   context to spend is the user's call);
 * - binary files (PDFs, archives, spreadsheets…) become base64 payloads the
 *   host writes to disk and hands to the model as a path to process with its
 *   tools.
 * Only files that can't be read at all are reported back by name.
 */
export async function stageFiles(inputFiles: File[]): Promise<StagedFiles> {
  const staged: StagedFiles = { images: [], files: [], rejected: [] };
  for (const file of inputFiles) {
    if (file.type.startsWith('image/')) {
      const image = await readImageFile(file);
      if (image) {
        staged.images.push({
          id: `img-${Date.now()}-${staged.images.length}-${file.name}`,
          ...image,
        });
      } else {
        staged.rejected.push(`${file.name} (unreadable)`);
      }
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      staged.rejected.push(`${file.name} (unreadable)`);
      continue;
    }
    const text = new TextDecoder().decode(bytes);
    const id = `file-${Date.now()}-${staged.files.length}-${file.name}`;
    if (looksBinary(text)) {
      staged.files.push({
        id,
        name: file.name,
        content: bytesToBase64(bytes),
        encoding: FileEncoding.Base64,
        ...(file.type ? { mediaType: file.type } : {}),
      });
    } else {
      staged.files.push({ id, name: file.name, content: text });
    }
  }
  return staged;
}
