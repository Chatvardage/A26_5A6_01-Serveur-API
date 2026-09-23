// En-têtes hop-by-hop (RFC 7230 §6.1) : propres à une connexion, ils ne
// doivent pas traverser le Gateway.
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
