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
  // When the device actually captured the survey. Null for records created
  // before this field existed, or by a client that doesn't report it - read
  // it as `captured_at ?? created_at`.
  captured_at: string | null;
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
  // ISO-8601 capture time, taken from the local record. Optional so callers
  // that have no capture time simply omit it and the server records none.
  capturedAt?: string;
}
