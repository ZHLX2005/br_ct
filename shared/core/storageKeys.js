/**
 * Centralized storage keys shared by popup, sidebar, and options pages.
 *
 * Any new key consumed by chrome.storage must be declared here first.
 * This avoids scattered string literals and makes the storage contract explicit.
 *
 * @module shared/core/storageKeys
 */

/**
 * Keys used in chrome.storage.local / chrome.storage.session.
 * Adding a new key requires updating this constant and documenting the schema.
 */
export const STORAGE_KEYS = {
  HISTORY: "messageHistory",
  OPTIMIZER: "selectedOptimizer",
  PLATFORM_VISIBILITY: "platformVisibilitySettings",
  PLATFORM_NAV: "platformNavSettings",
  LAST_MESSAGE: "lastMessage",
  PLATFORM_STATES: "platformStates",
  LAST_PROMPT_TEMPLATE: "lastPromptTemplate",
  PROMPTS_VERSION: "promptsVersion",
};