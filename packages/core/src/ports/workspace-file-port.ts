export interface WorkspaceFilePort {
  listFiles(): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
}
