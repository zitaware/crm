const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|apikey|api_key|bank|account_number|pan_number|aadhaar|otp/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-redacts values whose key matches a known-sensitive pattern. Used by
 * the logger before anything reaches stdout/stderr — never log secrets,
 * tokens, bank details, or other PII (docs/02, docs/09, docs/14).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return result;
  }

  return value;
}
