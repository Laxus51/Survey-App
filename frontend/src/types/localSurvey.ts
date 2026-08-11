// Local/offline representation of a captured survey - what the capture flow
// produces and (from Phase 6) what IndexedDB persists. Deliberately distinct
// from the API `Survey` type in survey.ts: this carries the raw compressed
// image Blob and camelCase local fields, not Django's response shape. A
// future sync engine will map a LocalSurvey to a SurveyWritePayload
// (survey.ts) when it actually calls the backend - that mapping does not
// exist yet, and nothing in this phase constructs a SurveyWritePayload.
export interface LocalSurvey {
  id: string;
  name: string;
  description: string;
  imageBlob: Blob;
  imageMimeType: string;
  imageFileName: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  attributes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
