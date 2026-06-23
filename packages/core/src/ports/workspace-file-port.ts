export interface WorkspaceFilePort {
  listFiles(): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
  /**
   * Read a file's raw bytes. Returned so callers can window into a file by byte
   * offset/size (rather than by line), which stays correct even when a file has
   * very long lines.
   */
  readFileBytes(relativePath: string): Promise<Uint8Array>;
  writeFile(relativePath: string, content: string): Promise<void>;
}
