/**
 * Promise wrapper around chrome.runtime.sendMessage for native host communication.
 *
 * Encapsulates the background → native_relay message flow. All popup/sidebar/options
 * callers should use sendNativeMessage instead of touching chrome.runtime directly,
 * so error semantics are uniform across the extension.
 *
 * @module shared/core/nativeBridge
 */

/**
 * Send a payload to the native host via the background service worker.
 *
 * Resolves with the native host response object on success.
 * Rejects with an Error when:
 *   - chrome.runtime.lastError is set (e.g. no receiver)
 *   - the response is missing entirely (native host did not respond)
 *   - the response.status is 'error' (native host returned a failure)
 *
 * @param {object} payload Payload forwarded to the native host.
 * @returns {Promise<{status: string, data: any, message?: string}>}
 */
export function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { action: "nativeMessage", payload },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error("Native host 无响应"));
            return;
          }
          if (response.status === "error") {
            reject(new Error(response.message || "操作失败"));
            return;
          }
          resolve(response);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}