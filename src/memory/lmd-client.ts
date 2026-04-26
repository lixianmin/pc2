export interface LmdSearchResult {
  id: string;
  content: string;
  type: 'fact' | 'episode' | 'relation';
  score: number;
  created_at: string;
}

export class LmdMcpClient {
  constructor(private port: number, private host: string) {}

  async search(query: string, limit: number = 10): Promise<LmdSearchResult[]> {
    throw new Error('Not implemented — will be implemented in memory task');
  }

  async addFact(content: string): Promise<string> {
    throw new Error('Not implemented');
  }

  async addEpisode(content: string): Promise<string> {
    throw new Error('Not implemented');
  }

  async addRelation(subject: string, predicate: string, object: string): Promise<string> {
    throw new Error('Not implemented');
  }

  async delete(ids: string[]): Promise<void> {
    throw new Error('Not implemented');
  }
}
