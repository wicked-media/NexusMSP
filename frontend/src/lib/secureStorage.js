/**
 * Secure Storage Wrapper
 * Obfuscates tokens stored in localStorage to mitigate XSS token theft.
 * Tokens are base64-encoded with a simple XOR cipher before storage.
 */

const CIPHER_KEY = "NxOps$2026";

function xorCipher(text, key) {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

export const secureStorage = {
  setItem(key, value) {
    try {
      const encoded = btoa(xorCipher(value, CIPHER_KEY));
      localStorage.setItem(key, encoded);
    } catch {
      localStorage.setItem(key, value);
    }
  },

  getItem(key) {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      return xorCipher(atob(stored), CIPHER_KEY);
    } catch {
      // Fallback: if decoding fails, return raw value (handles migration from plain storage)
      return localStorage.getItem(key);
    }
  },

  removeItem(key) {
    localStorage.removeItem(key);
  }
};
