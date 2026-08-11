import type { LocalSurvey } from "../types/localSurvey";

// The capture UI depends on this interface, not on IndexedDB or Django.
// Phase 6 replaces InMemorySurveyPersistence with a real IndexedDB-backed
// implementation behind the same interface - nothing in the capture
// components should need to change when that happens.
export interface SurveyPersistence {
  saveSurvey(survey: LocalSurvey): Promise<void>;
}

// Temporary stub for this phase only: kept in memory, lost on reload, never
// touches the network. It exists so the capture flow can be built and
// tested end-to-end without pretending a survey has been synchronized.
class InMemorySurveyPersistence implements SurveyPersistence {
  private readonly surveys = new Map<string, LocalSurvey>();

  async saveSurvey(survey: LocalSurvey): Promise<void> {
    this.surveys.set(survey.id, survey);
    console.info(
      `[stub persistence] saved survey ${survey.id} (${this.surveys.size} saved this session, not synced)`,
      survey,
    );
  }
}

export const surveyPersistence: SurveyPersistence = new InMemorySurveyPersistence();
