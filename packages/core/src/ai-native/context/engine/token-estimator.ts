/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Token Estimator & Deterministic Truncation Utilities
 */

/**
 * Deterministic token estimation heuristic: ~4 characters per token for source code.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Truncates text to fit within a given token budget deterministically.
 * Prefers truncating at a line boundary to preserve syntax integrity.
 */
export function truncateToTokens(
  text: string,
  maxTokens: number
): { text: string; estimatedTokens: number; truncated: boolean } {
  if (maxTokens <= 0) {
    return { text: '', estimatedTokens: 0, truncated: text.length > 0 };
  }

  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return {
      text,
      estimatedTokens: estimateTokens(text),
      truncated: false
    };
  }

  // Find the last newline before maxChars
  const cutIndex = text.lastIndexOf('\n', maxChars);
  let truncatedText: string;

  if (cutIndex > maxChars * 0.5) {
    // If a newline exists in the latter half of the allowed window, cut cleanly at the newline
    truncatedText = text.substring(0, cutIndex) + '\n// [TRUNCATED DUE TO CONTEXT BUDGET]';
  } else {
    // Otherwise cut directly at maxChars
    truncatedText = text.substring(0, maxChars) + '... [TRUNCATED]';
  }

  return {
    text: truncatedText,
    estimatedTokens: estimateTokens(truncatedText),
    truncated: true
  };
}
