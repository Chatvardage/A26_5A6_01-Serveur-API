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

---

## D6 — Pas d'`Access-Control-Allow-Credentials`

**Recommandation reçue** : émettre `Access-Control-Allow-Credentials: true`, au motif que les clients envoyant un en-tête `Authorization` seraient bloqués par le navigateur.

**Décision** : non appliquée.

**Justification** :

- Un en-tête `Authorization` posé explicitement par le code client **ne nécessite pas** `credentials: 'include'`. Il est couvert par `Access-Control-Allow-Headers: Authorization,Content-Type`, déjà émis. Le mode `credentials` ne concerne que les cookies et l'authentification HTTP gérée par le navigateur.
- Auth-Service ne pose aucun cookie, et ni le Frontend ni le Dashboard n'utilisent `credentials` / `withCredentials`.
- Activer cet en-tête autoriserait des requêtes cross-origin porteuses de cookies sans aucun besoin : surface d'attaque (CSRF) ajoutée pour rien.

**À revoir si** : l'authentification passe à un cookie de session (HttpOnly). Il faudra alors émettre cet en-tête **et** ajouter une protection CSRF.

---

## D7 — Rate limit sur une liste explicite de routes

**Recommandation reçue** : inverser la logique (limiter toutes les routes `POST /api/auth/*` sauf exclusions), pour qu'une nouvelle route Auth ne soit pas non protégée par défaut.

**Décision** : non appliquée ; règle 6 d'`AGENTS.md` complétée.

**Justification** :

- Les seules routes `POST` sous `/api/auth` d'Auth-Service sont aujourd'hui `register` et `login` (`src/interface/http/routes.rs`), toutes deux limitées. L'inversion ne changerait rien au comportement actuel.
- Le rate limit est indexé par IP. Appliqué par défaut à de futures routes authentifiées fréquentes (ex. refresh de jeton), il bloquerait des utilisateurs légitimes partageant une IP (NAT d'un réseau de classe ou d'entreprise).
- Le rate limit vise les routes **publiques** coûteuses (Argon2). Les routes authentifiées sont protégées par le Bearer, validé par Auth-Service.

**À revoir si** : Auth-Service ajoute plusieurs routes publiques. Envisager alors un préfixe dédié (ex. `/api/auth/public/*`) limité en bloc.

---

## D8 — Origine CORS `null` acceptée si configurée

**Contexte** : `CORS_ORIGINS` accepte la valeur littérale `null`, pour une application Electron packagée qui charge ses pages en `file://` (`loadFile`).

**Décision** : conservée, **désactivée par défaut** (`CORS_ORIGINS=http://localhost:5173` dans `.env.example` et dans le Compose d'`Infra`).

**Justification et conditions d'usage** :

- Les navigateurs envoient aussi `Origin: null` pour les pages ouvertes depuis `file://`, les iframes `sandbox` et certaines redirections. Autoriser `null` revient à autoriser **toutes** ces sources, dont une page piégée.
- Le risque reste borné : le Gateway n'émet pas `Access-Control-Allow-Credentials` (D6), et un attaquant doit disposer d'un Bearer valide pour atteindre les routes protégées.
- Usage acceptable : poste local ou déploiement où le Gateway n'est joignable que par l'application Electron. **Jamais** sur un Gateway exposé publiquement à des navigateurs.
- Une application Electron qui appelle l'API depuis le processus principal n'envoie pas d'en-tête `Origin` et n'a pas besoin de `null`.

**À revoir si** : le Frontend est servi par un protocole personnalisé (ex. `app://`), qui fournit une origine précise à inscrire dans `CORS_ORIGINS` à la place de `null`.

---

## D9 — Les tests unitaires accèdent aux membres privés via `(service as any)`

**Recommandation reçue** : injecter un client HTTP abstrait par le constructeur plutôt que de remplacer `httpRequest` / `httpsRequest` ou d'appeler des méthodes privées depuis les tests.

**Décision** : non appliquée.

**Justification** :

- L'abstraction n'aurait qu'un seul usage réel (`node:http` / `node:https`). Elle ajouterait un provider Nest, une interface et du câblage uniquement pour les tests.
- La plomberie réseau réelle est vérifiée par les tests e2e (`test/app.e2e-spec.ts`), qui démarrent de vrais serveurs HTTP amont sans aucun accès aux membres privés.
- Les tests unitaires servent surtout à couvrir des séquences difficiles à provoquer sur un vrai réseau (socket détruit juste avant l'upgrade, `ECONNRESET` après le tunnel, etc.), nécessaires au seuil de couverture de 100 %. Ce couplage à l'implémentation est accepté pour ces tests.

**À revoir si** : un second transport ou client HTTP devient nécessaire (proxy sortant, mTLS, client instrumenté). L'injection se justifierait alors par le code de production, et les tests en profiteraient.

---

## D10 — `firstHeader()` ne garde que la première valeur d'un en-tête tableau

**Recommandation reçue** : joindre toutes les valeurs (`value.join(', ')`) au lieu de `value[0]`, au motif que plusieurs en-têtes `X-Forwarded-For` distincts seraient reçus sous forme de tableau et que la chaîne d'IP serait tronquée.

**Décision** : non appliquée.

**Justification** :

- Le constat de départ est inexact. Node fusionne lui-même les en-têtes répétés en une seule chaîne séparée par des virgules ; seul `set-cookie` est exposé sous forme de tableau (certains en-têtes comme `host` ou `content-type` gardent seulement la première occurrence). Vérifié sur un vrai serveur Node 22 : deux lignes `X-Forwarded-For: 1.1.1.1` et `X-Forwarded-For: 2.2.2.2` donnent `req.headers['x-forwarded-for'] === "1.1.1.1, 2.2.2.2"`.
- `request.headers['x-forwarded-for']` et `['x-forwarded-proto']` ne sont donc jamais des tableaux en production : la branche `Array.isArray` n'existe que pour le typage (`IncomingHttpHeaders`) et les mocks de test.
- Pour `x-forwarded-proto`, garder la première valeur est d'ailleurs le comportement voulu (le protocole vu par le premier proxy).

**À revoir si** : le Gateway reçoit ses en-têtes d'une autre source que `node:http` (par exemple un adaptateur HTTP/2 ou une plateforme serverless qui exposerait des tableaux).

---

## D11 — Signalements de revue vérifiés et écartés

Ces points ont été soulevés par des revues automatiques puis **infirmés par des essais réels** : Gateway compilé (`node dist/main`, Node 22) placé devant un faux service amont qui journalise ce qu'il reçoit. Ne pas les rouvrir sans nouvel élément.

### D11.1 — « Un `DELETE` sans corps est transmis avec un corps vide et `Content-Length: 0` »

- **Proposition** : restreindre `hasRequestBody()` à `POST`, `PUT` et `PATCH`.
- **Constat** : un `DELETE` sans corps arrive en amont **sans** `Content-Length`, sans `Transfer-Encoding` et avec 0 octet, que le client passe par `fetch` ou par un socket brut. undici n'émet rien pour un `Buffer` vide sur ces méthodes.
- **Décision** : pas de changement. La restriction proposée supprimerait en plus le corps d'un `DELETE` qui en porte un, contrairement à la règle 4 d'`AGENTS.md` (préserver les corps).

### D11.2 — « Une réponse `429` sans lecture du corps désynchronise la connexion keep-alive »

- **Proposition** : forcer `Connection: close` et `request.socket.destroySoon()` après le `429`.
- **Constat** : sur **une seule** connexion keep-alive, la séquence login autorisé → login refusé → `GET /api/health` donne `200, 429, 200`. Quand la réponse se termine avant la lecture complète de la requête, Node lit et jette lui-même le reste du corps (`req._dump()`), ce qui garde le parseur HTTP synchronisé.
- **Décision** : pas de changement. Fermer la connexion n'apporterait rien et forcerait le client à en rouvrir une.

### D11.3 — « Le port `0` d'une URL amont est remplacé par le port 80 »

- **Proposition** : remplacer `target.port || défaut` par une comparaison explicite à `''`.
- **Constat** : `new URL('http://h:0/').port === '0'`. Une chaîne non vide est vraie en JavaScript : `||` conserve donc bien `'0'`. Seule la chaîne vide (aucun port dans l'URL) déclenche le port par défaut, ce qui est le comportement voulu.
- **Décision** : pas de changement. Un port `0` n'aurait de toute façon aucun sens pour un service amont.

---

## D12 — `PROXY_TIMEOUT_MS` est appliqué par phase

**Recommandation reçue** : transformer `PROXY_TIMEOUT_MS` en échéance globale afin d'éviter le cumul du délai de lecture du corps et des appels internes.

**Décision** : non appliquée; la sémantique par phase est conservée et documentée.

**Justification** :

- Le délai protège des opérations distinctes : réception du corps client, appel Auth préalable à User-Config et appel au service métier.
- Une échéance globale ferait dépendre le temps accordé au service amont de la vitesse d'envoi du client et demanderait de propager un budget restant entre les opérations.
- Les clients prévus envoient de petits corps JSON; le cumul maximal est donc un cas dégradé, pas le chemin normal.
- Une requête avec corps peut approcher deux fois le délai. Une requête User-Config avec corps peut en approcher trois fois.

**À revoir si** : un SLO de latence de bout en bout est défini pour le Gateway.

---

## D13 — L'écouteur d'erreur client reste actif lors d'un refus d'upgrade WebSocket

**Recommandation reçue** : retirer `onClientErrorBeforeUpgrade` lorsque l'amont répond en HTTP classique au lieu d'établir le tunnel.

**Décision** : non appliquée.

**Justification** :

- Pendant le relais de la réponse HTTP de refus, le socket client peut encore émettre une erreur. Sans écouteur, cette erreur non gérée peut arrêter le processus Node.
- L'écouteur détruit alors la requête amont, ce qui est le nettoyage attendu si le client disparaît.
- Le socket est fermé à la fin de cette réponse (`Connection: close`). L'écouteur devient alors collectable avec le socket et ne constitue pas une fuite durable.

**À revoir si** : les réponses HTTP de refus sont relayées par une abstraction qui possède explicitement le cycle de vie des deux flux.

---

## D14 — Le quota Auth reste indépendant par route

**Recommandation reçue** : partager un seul quota entre `POST /api/auth/login` et `POST /api/auth/register` afin qu'une adresse IP ne puisse pas consommer deux quotas dans une même fenêtre.

**Décision** : non appliquée.

**Justification** :

- Le contrat actuel est explicitement un quota par IP **et par route**, documenté dans `README.md` et `.env.example`.
- Les deux opérations ont des usages légitimes distincts. Un quota commun permettrait à un trafic de création de comptes de bloquer les connexions, ou inversement, notamment derrière un NAT.
- Les deux routes coûteuses sont déjà limitées; doubler au plus le nombre d'opérations possibles par fenêtre est un compromis assumé pour éviter ce couplage.

**À revoir si** : des métriques montrent une saturation Argon2 coordonnée sur les deux routes. Envisager alors des quotas séparés plus bas ou un second plafond agrégé.

---

## D15 — L'audit npm du CI couvre les dépendances de dev et reste bloquant

**Recommandation reçue** : limiter `npm audit` aux dépendances de production (`--omit=dev`), ou le rendre non bloquant (`|| true`, `continue-on-error`) pour éviter qu'un avis sans correctif amont bloque le CI.

**Décision** : non appliquée.

**Justification** :

- Une vulnérabilité `high` dans une dépendance de dev est déjà passée inaperçue dans le Dashboard (`minimatch` 9.0.3 épinglé par `@typescript-eslint/typescript-estree` 6.x : GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74), précisément parce que son CI omettait les dépendances de dev.
- Un audit non bloquant ne serait pas lu.
- Un avis sans correctif se traite au cas par cas : `overrides` ciblé vers une version corrigée, sinon exception consignée ici (paquet, avis, raison, condition de retrait).

**À revoir si** : un avis `high` sans correctif ni `overrides` possible, sur un outil de dev uniquement, bloque le CI plus d'une semaine.

## D16 — Quota sur refresh et logout

Les nouvelles routes refresh/logout présentent un token opaque dans le corps,
sans Bearer. Elles entrent donc dans la liste des appels publics limités (règle 6),
avec un quota indépendant par IP et route. D7 ne concerne pas ces routes : le
refresh actuel n'est pas une route authentifiée par Bearer. Le Gateway transmet
le contrat intact et Auth reste la source de vérité.
