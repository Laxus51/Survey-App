import { authorizedRequest } from "./httpClient";
import type { PaginatedResponse } from "../types/api";
import type { Survey, SurveySyncResult, SurveyWritePayload } from "../types/survey";

function buildSurveyFormData(payload: SurveyWritePayload): FormData {
  const formData = new FormData();
  if (payload.id) formData.set("id", payload.id);
  formData.set("name", payload.name);
  formData.set("description", payload.description ?? "");
  formData.set("image", payload.image);
  formData.set("latitude", String(payload.latitude));
  formData.set("longitude", String(payload.longitude));
  formData.set("accuracy", String(payload.accuracy));
  formData.set("attributes", JSON.stringify(payload.attributes ?? {}));
  return formData;
}

export function listSurveys(page = 1, pageSize = 20): Promise<PaginatedResponse<Survey>> {
  return authorizedRequest<PaginatedResponse<Survey>>("/api/surveys/", {
    query: { page, page_size: pageSize },
  });
}

export function getSurvey(id: string): Promise<Survey> {
  return authorizedRequest<Survey>(`/api/surveys/${id}/`);
}

export function createSurvey(payload: SurveyWritePayload): Promise<Survey> {
  return authorizedRequest<Survey>("/api/surveys/", {
    method: "POST",
    body: buildSurveyFormData(payload),
  });
}

export function updateSurvey(id: string, payload: SurveyWritePayload): Promise<Survey> {
  return authorizedRequest<Survey>(`/api/surveys/${id}/`, {
    method: "PUT",
    body: buildSurveyFormData(payload),
  });
}

export function deleteSurvey(id: string): Promise<void> {
  return authorizedRequest<void>(`/api/surveys/${id}/`, { method: "DELETE" });
}

export function syncSurvey(payload: SurveyWritePayload): Promise<SurveySyncResult> {
  return authorizedRequest<SurveySyncResult>("/api/surveys/sync/", {
    method: "POST",
    body: buildSurveyFormData(payload),
  });
}
