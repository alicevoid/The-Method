/**
 * Central Import Hub for +page.svelte
 *
 * This file re-exports all the modules and types that +page.svelte needs.
 * Instead of importing from multiple files, just import from '$lib'.
 *
 * Usage in +page.svelte:
 *   import { loadAllSearchTerms, formatSearchTermToURL, type SearchPattern } from '$lib';
 */

// ============================================================================
// DATA LOADING (from method-logic.ts)
// ============================================================================
export { loadAllSearchTerms, saveSearchTerm, updateSearchTerm, deleteSearchTerm } from './method-logic.js';

// ============================================================================
// TYPES (from method-logic.ts)
// ============================================================================
export type { SearchPattern, Constraint } from './method-logic.js';

// ============================================================================
// URL FORMATTING (from search-settings.ts)
// ============================================================================
export { formatSearchTermToURL, fillSpecifierTemplate } from './search-settings.js';

// ============================================================================
// DEPRECATED (kept for backward compatibility - will be removed)
// ============================================================================
// Uncomment if you need the old SearchSettings class temporarily
// export { SearchSettings } from './search-settings.js';
