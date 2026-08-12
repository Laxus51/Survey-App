import type { LocalSurvey } from "./localSurvey";
import type { SyncStatus } from "./survey";

// What actually lives in IndexedDB: a LocalSurvey plus the local sync queue
// state. Kept as its own type (not folded into LocalSurvey) because the
// capture flow constructs a LocalSurvey with no notion of sync state at
// all - that state is a persistence-layer concern, attached only once a
// survey is saved. Must carry everything a future sync engine needs to
// identify and upload the complete survey without reconstructing anything.
export interface LocalSurveyRecord extends LocalSurvey {
  syncStatus: SyncStatus;
  retryCount: number;
}
