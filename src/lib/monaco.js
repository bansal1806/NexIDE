import { loader } from '@monaco-editor/react';

// Pin the Monaco build loaded from the CDN. @monaco-editor/loader's default (0.55.1)
// bundles a DOMPurify version with known XSS advisories; 0.57.0 ships 3.4.15.
// Keep this origin in sync with the CSP in vercel.json.
export const MONACO_VERSION = '0.57.0';
export const MONACO_CDN = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

loader.config({ paths: { vs: MONACO_CDN } });
