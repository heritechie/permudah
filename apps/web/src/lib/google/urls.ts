const ALLOWED_WEB_APP_HOSTS = new Set(["script.google.com"]);
const ALLOWED_SPREADSHEET_HOSTS = new Set(["docs.google.com"]);

function isHttpsGoogleUrl(value: string, hosts: Set<string>): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && hosts.has(url.hostname);
}

export function isGoogleWebAppUrl(value: string): boolean {
  return isHttpsGoogleUrl(value, ALLOWED_WEB_APP_HOSTS);
}

export function isGoogleSpreadsheetUrl(value: string): boolean {
  return isHttpsGoogleUrl(value, ALLOWED_SPREADSHEET_HOSTS);
}
