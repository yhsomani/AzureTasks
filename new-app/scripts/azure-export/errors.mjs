export function classifyError(error) {
  const status = error?.status;
  const text = String(error?.response || error?.message || '');
  if (status === 401 || status === 403) return 'permission';
  if (status === 429 || status === 502 || status === 503 || status === 504) return 'transient';
  if (status === 404) return /not found|does not exist/i.test(text) ? 'not_available' : 'unsupported';
  if (status === 400 && /preview|not supported|invalid.*api/i.test(text)) return 'unsupported';
  if (status === 400 && /VS402337|exceeds the size limit/i.test(text)) return 'pagination_limit';
  if (status >= 500) return 'server';
  return status ? 'http' : 'network';
}
