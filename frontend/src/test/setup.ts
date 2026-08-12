// fake-indexeddb is a spec-compliant, pure-JS reimplementation of IndexedDB
// (used widely for testing real IndexedDB-consuming code under Node) - not a
// mock of this project's own code. It's the closest available substitute
// for real-browser verification in an environment without a browser
// automation tool this session; see the Phase 6A report for the full
// rationale on why this was brought in as a dev-only dependency.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

// jsdom's own Blob class isn't what Node's native structuredClone (which
// fake-indexeddb relies on to clone stored records) recognizes as
// cloneable. Using Node's real Blob keeps IndexedDB Blob storage working in
// tests; this is a test-environment-only shim, unrelated to the app's own
// runtime code (which only ever runs in a real browser).
import { Blob as NodeBlob } from "node:buffer";
globalThis.Blob = NodeBlob as unknown as typeof Blob;
