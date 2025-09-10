import { getApiConfig } from '../config/api';

export async function fetchFacetSuggestions(selected: string[]) {
  const { baseURL } = getApiConfig();
  const r = await fetch(`${baseURL}/api/search/facet-suggestions?tokens=${selected.join(',')}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" }
  });
  return r.json();
}

export async function postClick(token: string) {
  const { baseURL } = getApiConfig();
  await fetch(`${baseURL}/api/analytics/click`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token_type: "GENERIC", token_value: token })
  });
}

export async function postShow(tokens: Array<{token_type: string, token_value: string}>) {
  const { baseURL } = getApiConfig();
  await fetch(`${baseURL}/api/analytics/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens })
  });
}

export async function getGlobalCounts() {
  const { baseURL } = getApiConfig();
  const r = await fetch(`${baseURL}/api/search/global-counts`);
  return r.json();
}

export async function getTokenCoverage() {
  const { baseURL } = getApiConfig();
  const r = await fetch(`${baseURL}/api/tokens/coverage`);
  return r.json();
}

export async function rebuildPartTokens() {
  const { baseURL } = getApiConfig();
  const r = await fetch(`${baseURL}/api/admin/rebuild-part-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  return r.json();
}
