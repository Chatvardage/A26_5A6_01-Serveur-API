# Décisions techniques — Serveur-API

Ce fichier liste les recommandations de revue de code **volontairement non appliquées** (ou appliquées autrement que proposé), avec leur justification. Avant de rouvrir l'un de ces sujets, vérifier si le contexte décrit ici a changé.

---

## D1 — `GatewayConfigService` garde le pattern `readonly!` + `Object.assign`

**Recommandation reçue** : remplacer par une propriété `readonly config: GatewayConfig`, au motif que si `resolveGatewayConfig()` levait une exception, les champs resteraient `undefined` sans avertissement.

**Décision** : non appliquée.

**Justification** :

- Le risque décrit n'existe pas : si `resolveGatewayConfig()` lève une exception, c'est le constructeur qui échoue. Nest ne peut alors pas instancier le provider et l'application ne démarre pas. Aucune instance partiellement initialisée ne peut être injectée.
- `resolveGatewayConfig()` retourne un `GatewayConfig` complet et typé, et `GatewayConfigService implements GatewayConfig` : un champ oublié dans l'un ou l'autre est signalé à la compilation.
- Le changement imposerait `config.config.xxx` dans tous les services et tous les mocks de test, pour un gain uniquement stylistique.

**À revoir si** : la configuration devient partiellement optionnelle ou rechargeable à chaud.

---

## D2 — Pas de limite de taille sur les réponses des services internes

**Recommandation reçue** : borner la réponse d'erreur d'Auth-Service dans `resolveAuthenticatedUserId()`, au motif que les réponses proxy normales seraient déjà bornées par `MAX_PROXY_BODY_BYTES`.

**Décision** : non appliquée ; limite documentée dans `AGENTS.md` (section « Limites connues »).

**Justification** :

- Le constat de départ est inexact : `MAX_PROXY_BODY_BYTES` ne borne que le **corps entrant** (`readBody()`). **Toutes** les réponses amont (`forward()` comme `resolveAuthenticatedUserId()`) sont bufferisées sans limite. Borner uniquement le chemin d'erreur d'Auth créerait une protection incohérente.
- Les services internes (Auth, Room, Message, User-Config) sont développés par l'équipe et joignables uniquement sur `chatvardage-network`. Ils sont considérés comme de confiance.
- La bonne correction serait de relayer les réponses en streaming. Cela modifie la gestion d'erreurs (en-têtes déjà envoyés en cours de transfert), le comportement de `PROXY_TIMEOUT_MS` et l'ensemble des mocks de test. C'est disproportionné pour un risque faible.

**À revoir si** : une route d'upload/export est ajoutée, ou si un service tiers non maîtrisé est placé derrière le Gateway. Passer alors au streaming pour les requêtes **et** les réponses.

---

## D3 — Un client trop lent voit sa connexion fermée, sans code `408`

**Contexte** : `readBody()` borne la lecture du corps entrant par `PROXY_TIMEOUT_MS` (protection contre les clients lents de type slowloris).

**Décision** : à l'expiration, la connexion est détruite et un avertissement est journalisé. Aucune réponse HTTP n'est envoyée.

**Justification** :

- La règle 5 d'`AGENTS.md` restreint les codes produits par le Gateway à `413`, `429`, `502`, `503` et `504`. Ajouter `408` modifierait ce contrat.
- Interrompre l'itération d'un flux Node détruit la requête et, avec elle, le socket. Répondre proprement exigerait de suspendre la lecture sans détruire le flux, ce qui complique le code pour un client qui, par hypothèse, ne coopère pas.
- Un client légitime (Frontend Electron, Dashboard) envoie des corps JSON de petite taille en quelques millisecondes : il n'est pas concerné.

---

## D4 — `X-Forwarded-For` : une seule couche de reverse proxy de confiance

**Contexte** : avec `TRUST_PROXY=true`, la clé de rate limit est la **dernière** adresse de `X-Forwarded-For`, et non la première, que le client peut forger.

**Décision** : on suppose **exactement un** reverse proxy de confiance devant le Gateway.

**Justification** : c'est la topologie prévue (un proxy TLS au maximum devant le Gateway). Gérer N proxies de confiance exigerait un paramètre supplémentaire (nombre de sauts ou liste d'adresses de confiance) sans cas d'usage actuel.

**À revoir si** : plusieurs proxies sont chaînés devant le Gateway (CDN + load balancer, par exemple). Il faudra alors ignorer autant d'entrées de fin de chaîne qu'il y a de proxies de confiance.

---

## D5 — Rate limit en mémoire, par instance

**Recommandation reçue** : le rate limit n'est pas distribué entre plusieurs instances.

**Décision** : conservé en mémoire ; limite documentée dans `AGENTS.md`.

**Justification** : le déploiement prévu (Docker Compose d'`Infra`) exécute une seule instance du Gateway. Un store partagé impliquerait de brancher le Gateway sur Redis, ce que la règle 8 d'`AGENTS.md` interdit dans ce dépôt.

**À revoir si** : le Gateway est déployé en plusieurs réplicas.
