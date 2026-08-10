export type SyncStatus = "pending" | "syncing" | "synced" | "failed";

export interface Survey {
  id: string;
  user: number;
  name: string;
  description: string;
  image: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  attributes: Record<string, string>;
  sync_status: SyncStatus;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface SurveySyncResult extends Survey {
  created: boolean;
}

export interface SurveyWritePayload {
  id?: string;
  name: string;
  description?: string;
  image: File | Blob;
  latitude: number;
  longitude: number;
  accuracy: number;
  attributes?: Record<string, string>;
}
