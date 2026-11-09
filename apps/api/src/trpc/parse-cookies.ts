/** Minimal Cookie-header parser — avoids adding the `cookie-parser`
 * dependency for a single header split. */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) {
      result[name] = decodeURIComponent(value);
    }
  }
  return result;
}
