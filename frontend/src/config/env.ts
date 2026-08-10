// Central place to read build-time environment configuration.
// Actual API client construction happens in src/services (Phase 5).
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string
