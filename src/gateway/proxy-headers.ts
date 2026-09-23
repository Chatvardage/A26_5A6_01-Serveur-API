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

// Node fusionne déjà les en-têtes répétés en une seule chaîne (sauf
// set-cookie) : le cas tableau ne sert qu'au typage (docs/DECISIONS.md, D10).
export function firstHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
