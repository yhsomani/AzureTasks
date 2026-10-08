/**
 * TypeScript type definitions for Azure DevOps REST API v7.0/v7.1
 */

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: {
    comment?: string;
    isLocked?: boolean;
    name?: string;
    [key: string]: unknown;
  };
}

export interface WorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: WorkItemRelation[];
  url: string;
}

export interface WiqlQueryResult {
  queryType: string;
  queryResultType: string;
  asOf: string;
  workItems: Array<{
    id: number;
    url: string;
  }>;
}

export interface WorkItemBatchRequest {
  ids: number[];
  fields?: string[];
  $expand?: 'all' | 'relations' | 'fields' | 'none';
  errorPolicy?: 'fail' | 'omit';
}

export interface WorkItemBatchResponse {
  count: number;
  value: WorkItem[];
}

export interface AzureProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
  revision: number;
  visibility: string;
}

export interface WorkItemTypeDefinition {
  name: string;
  referenceName: string;
  description?: string;
  color?: string;
  icon?: { id: string; url: string };
  isDisabled?: boolean;
  fields?: Array<{
    referenceName: string;
    name: string;
    type: string;
    alwaysRequired?: boolean;
  }>;
}
