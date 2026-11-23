declare module '*/scripts/azure-export/schema.mjs' {
  export const NORMALIZED_SCHEMA: string;
}

declare module '*/scripts/azure-export/normalize.mjs' {
  export function normalizeDatabase(databasePath: string): {
    projects: number;
    workItems: number;
    repositories: number;
    pullRequests: number;
    builds: number;
  };
}

declare module '*/scripts/azure-export/sqlite-writer.mjs' {
  export class SqliteExportWriter {
    outputPath: string;
    runId: string;
    mode: string;
    projects: string[];
    organization: string;
    stagingPath: string;
    constructor(outputPath: string, options: { runId?: string; mode?: string; projects?: string[]; organization?: string });
    initialize(): void;
    setMeta(key: string, value: string): void;
    saveDataset(scope: string, projectName: string, payload: unknown): void;
    saveStep(scope: string, status: string, recordCount: number, durationMs: number, message?: string): void;
    saveCursor(projectName: string, resourceType: string, cursor: string): void;
    importCursors(rows?: Array<{ project_name: string; resource_type: string; cursor?: string; updated_at?: string }>): void;
    saveError(error: { scope: string; status?: number | null; category: string; message?: string; cause?: string; response?: string; url?: string | null }): void;
    publish(status?: string): { runId: string; datasetCount: number; errorCount: number; outputPath: string };
    abort(): void;
  }
}
