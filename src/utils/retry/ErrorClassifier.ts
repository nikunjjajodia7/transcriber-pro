export function classifyError(error: any) {
  const message = toMessage(error);
  if (includesAny(message, [
    "unauthorized",
    "invalid api key",
    "api key is not configured",
    "forbidden"
  ]) || matchesStatusCode(message, [401, 403])) {
    return { errorClass: "auth", retryable: false };
  }
  if (includesAny(message, ["rate limit", "quota", "too many requests"]) || matchesStatusCode(message, [429])) {
    return { errorClass: "rate_limit", retryable: true };
  }
  if (includesAny(message, [
    "invalid request",
    "invalid response format",
    "invalid transcription response",
    "file too large",
    "payload",
    "unprocessable"
  ]) || matchesStatusCode(message, [400])) {
    return { errorClass: "payload", retryable: false };
  }
  if (includesAny(message, ["timed out", "timeout", "etimedout"])) {
    return { errorClass: "timeout", retryable: true };
  }
  if (includesAny(message, [
    "network",
    "failed to fetch",
    "econn",
    "enotfound",
    "socket",
    "dns",
    "connection"
  ])) {
    return { errorClass: "network", retryable: true };
  }
  if (includesAny(message, [
    "server error",
    "internal server error",
    "bad gateway"
  ]) || matchesStatusCode(message, [500, 502, 503, 504])) {
    return { errorClass: "server", retryable: true };
  }
  return { errorClass: "unknown", retryable: false };
}
function toMessage(error: any) {
  if (error instanceof Error)
    return error.message.toLowerCase();
  if (typeof error === "string")
    return error.toLowerCase();
  return "unknown error";
}
function includesAny(value: any, patterns: any) {
  return patterns.some((p: any) => value.includes(p));
}
function matchesStatusCode(message: any, codes: any) {
  return codes.some((code: any) => new RegExp(`(?:^|\\b|status\\s*)${code}(?:\\b|$)`).test(message));
}
