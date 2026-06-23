export interface WorkspaceFilePort {
  listFiles(): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
}
