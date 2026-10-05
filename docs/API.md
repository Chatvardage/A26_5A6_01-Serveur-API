# Documentation du contrat

La référence est maintenue dans [Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/gateway.md). Mettre cette référence à jour avec le code du service.

Les routes de session `POST /api/auth/refresh` et `POST /api/auth/logout` sont
relayées telles quelles et soumises au quota Auth. Leur corps contient un
`refresh_token` opaque; aucun token ne passe dans l'URL.
