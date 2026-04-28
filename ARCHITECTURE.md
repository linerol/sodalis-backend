# Dossier d'architecture — Sodalis Backend

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Diagramme d'architecture](#2-diagramme-darchitecture)
3. [Services et responsabilités](#3-services-et-responsabilités)
4. [Modes de communication](#4-modes-de-communication)
5. [Modèles de données](#5-modèles-de-données)
6. [Sécurité et authentification](#6-sécurité-et-authentification)
7. [Caching](#7-caching)
8. [Notifications temps réel](#8-notifications-temps-réel)
9. [Choix stratégiques](#9-choix-stratégiques)

---

## 1. Vue d'ensemble

**Sodalis** est une application de gestion de colocation. Son backend est structuré en **quatre microservices Node.js/Express indépendants**, orchestrés par Docker Compose et exposés au client via un unique point d'entrée GraphQL.

Les services communiquent selon trois protocoles distincts, choisis en fonction de la nature du besoin :

| Besoin | Protocole |
|---|---|
| Client → Backend | GraphQL (HTTP) |
| Appels synchrones inter-services | gRPC |
| Événements asynchrones | Redis Pub/Sub |
| Notifications temps réel vers client | Socket.io (WebSocket) |

---

## 2. Diagramme d'architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          RÉSEAU DOCKER (sodalis-net)                  │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                     api-gateway :4000                          │   │
│  │              Apollo Server 5 — GraphQL                         │   │
│  │   • Proxy HTTP vers les services                               │   │
│  │   • Vérification JWT + contrôle d'appartenance coloc           │   │
│  │   • Cache Redis (dashboard, TTL 30 s, invalidation par clé)    │   │
│  └──────────────┬─────────────────────┬──────────────────┬────────┘   │
│        HTTP     │              HTTP   │           HTTP   │            │
│                 ▼                     ▼                  ▼            │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │   service-domus      │  │  service-labor   │  │service-concordia│ │
│  │   :3001 (REST)       │  │  :3002 (REST)    │  │  :3003 (REST)  │  │
│  │   :50051 (gRPC)      │  │  :50052 (gRPC)   │  │  + Socket.io   │  │
│  │                      │  │                  │  │                │  │
│  │  Utilisateurs        │  │  Tâches          │  │  Notifications │  │
│  │  Colocations         │  │  Assignations    │  │  Plaintes      │  │
│  │  Maintenance         │  │                  │  │  Sondages      │  │
│  │  Auth (register/     │  │                  │  │  Karma         │  │
│  │        login)        │  │                  │  │                │  │
│  └──────┬───────────────┘  └──────────┬───────┘  └───────┬────────┘  │
│         │  PostgreSQL               PostgreSQL           MongoDB      │
│         │  (domus-db :5432)         (labor-db :5433)    (:27017)      │
│         │                                                │            │
│         │  ◄── gRPC VerifyUser ──────────────────────►  │            │
│         │  ◄── gRPC CreateTask ──────────────────────►  │            │
│         │                                                │            │
│         │      Redis Pub/Sub (canal : sodalis_events)    │            │
│         └─────────────────────────► redis :6379 ◄────────┘            │
│                                          │                            │
│                                          │ subscribe                  │
│                               service-concordia                       │
│                                     (ci-dessus)                       │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘

Client (navigateur / app mobile)
  │
  ├── GraphQL HTTP  ──► api-gateway :4000
  └── WebSocket     ──► service-concordia :3003
```

---

## 3. Services et responsabilités

### api-gateway (port 4000)

Point d'entrée unique du système. Il n'a pas de base de données propre.

**Rôle :**
- Expose un schéma GraphQL unifié (Apollo Server 5)
- Authentifie chaque requête : décode le JWT, rejette les tokens invalides avant même d'appeler un service
- Contrôle l'appartenance à la colocation dans chaque resolver (un utilisateur ne peut accéder qu'aux données de sa propre coloc, sauf rôle `ADMIN`)
- Orchestre les appels HTTP vers les services métier via `axios`
- Gère le cache Redis pour la query `getColocDashboard`
- Invalide le cache sur toutes les mutations qui modifient les données agrégées

**Queries GraphQL exposées :**

| Query | Service(s) appelé(s) | Mise en cache |
|---|---|---|
| `myColoc` | domus | Non |
| `usersByColoc` | domus + concordia (karma) | Non |
| `tasksByColoc` | labor | Non |
| `getColocDashboard` | domus + labor + concordia | Oui — Redis TTL 30 s |
| `maintenanceTickets` | domus | Non |
| `notifications` | concordia | Non |
| `complaints` | concordia | Non |
| `polls` | concordia | Non |

---

### service-domus (REST :3001 / gRPC :50051)

Source de vérité pour les identités et les colocations. Fait tourner simultanément un serveur Express et un serveur gRPC.

**Données gérées :** `colocs`, `users`, `maintenance_tickets`

**Routes REST :**

| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/register` | Inscription |
| POST | `/auth/login` | Connexion + émission JWT |
| POST | `/colocs` | Créer une coloc (transaction : crée + passe l'auteur ADMIN) |
| POST | `/colocs/join` | Rejoindre via code d'invitation |
| GET | `/colocs/:id` | Détail d'une coloc |
| GET | `/colocs/:id/users` | Membres de la coloc |
| POST | `/maintenance` | Créer un ticket (escalade auto en tâche si `priority = URGENT`) |
| GET | `/maintenance` | Liste des tickets |
| PATCH | `/maintenance/:id/status` | Changer le statut |
| PATCH | `/maintenance/:id/assign` | Assigner (ADMIN uniquement) |

**RPC gRPC exposé (`DomusService`) :**

```protobuf
rpc VerifyUser(VerifyUserRequest) returns (VerifyUserResponse)
// Vérifie qu'un user_id appartient bien à un coloc_id donné
```

**RPC gRPC consommé (`LaborService`) :**

```protobuf
rpc CreateTask(CreateTaskRequest) returns (CreateTaskResponse)
// Utilisé pour l'escalade automatique des tickets URGENT en tâche
```

---

### service-labor (REST :3002 / gRPC :50052)

Gestionnaire de tâches. Valide l'appartenance de l'assigné via gRPC avant toute insertion.

**Données gérées :** `tasks`

**Routes REST :**

| Méthode | Route | Description |
|---|---|---|
| POST | `/tasks` | Créer une tâche |
| GET | `/tasks/coloc/:id` | Tâches d'une coloc |
| PATCH | `/tasks/:id/status` | Mettre à jour le statut |

**Flux `POST /tasks` :**
1. Appel gRPC `VerifyUser` → domus (vérifie que l'assigné est dans la coloc)
2. Insertion en PostgreSQL
3. Publication `NEW_TASK` sur Redis
4. Invalidation du cache `dashboard_coloc_<coloc_id>`

**RPC gRPC exposé (`LaborService`) :**

```protobuf
rpc CreateTask(CreateTaskRequest) returns (CreateTaskResponse)
// Crée une tâche + publie l'événement Redis (appelé par domus pour les tickets URGENT)
```

---

### service-concordia (REST :3003 + Socket.io)

Service événementiel pur. Il n'initie aucun appel vers les autres services ; il réagit uniquement aux événements Redis.

**Données gérées :** `Notification` (MongoDB), `Complaint`, `Poll`, `Karma`

**Flux de traitement d'un événement Redis :**
1. Désérialise le message JSON
2. Persiste en MongoDB (`Notification.create`)
3. Émet via Socket.io sur la room ciblée (`coloc_<id>_notifications` ou `user_<id>_notifications`)

**Événements Redis traités :**

| Type | Room Socket.io cible |
|---|---|
| `NEW_TASK` | `coloc_<coloc_id>_notifications` |
| `TASK_UPDATED` | `coloc_<coloc_id>_notifications` |
| `NEW_MAINTENANCE_TICKET` | `coloc_<coloc_id>_notifications` |
| `MAINTENANCE_TICKET_UPDATED` | `coloc_<coloc_id>_notifications` |
| `MAINTENANCE_TICKET_ASSIGNED` | `coloc_<coloc_id>_notifications` |
| `NEW_COMPLAINT` | `coloc_<coloc_id>_notifications` |
| `COMPLAINT_TARGETED` | `user_<target_id>_notifications` |
| `COMPLAINT_RESOLVED` | `coloc_<coloc_id>_notifications` |
| `NEW_POLL` / `POLL_UPDATED` | `coloc_<coloc_id>_notifications` |
| `KARMA_UPDATED` | `coloc_<coloc_id>_notifications` |

**Routes REST exposées :**

| Méthode | Route | Description |
|---|---|---|
| GET | `/notifications/coloc/:id` | Historique paginé des notifications |
| POST/GET | `/api/complaints` | Gestion des plaintes |
| POST/GET | `/api/polls` | Gestion des sondages |
| GET | `/api/karma` | Profils karma de la coloc |
| POST | `/api/karma/:id/thank` | Remercier un colocataire |

---

## 4. Modes de communication

### 4.1 HTTP/GraphQL — Client → Gateway → Services

Le client ne connaît qu'une seule URL : `http://gateway:4000/graphql`. Le gateway traduit chaque opération GraphQL en un ou plusieurs appels REST `axios` vers les services. Le header `Authorization: Bearer <token>` est transféré tel quel à chaque service en aval.

### 4.2 gRPC — Appels synchrones inter-services

Deux contrats protobuf définissent les RPC disponibles :

**`shared/domus.proto` — DomusService**

```
service-labor ──► VerifyUser ──► service-domus
```
Avant toute création de tâche, labor demande à domus si l'assigné appartient à la coloc. C'est une **vérification d'autorisation distribuée** : labor ne stocke pas les utilisateurs, il délègue au service qui en est la source de vérité.

**`shared/labor.proto` — LaborService**

```
service-domus ──► CreateTask ──► service-labor
```
Lorsqu'un ticket de maintenance est créé avec `priority = URGENT`, domus escalade automatiquement en appelant labor pour créer une tâche associée. Ce RPC crée la tâche, publie l'événement Redis, et invalide le cache, exactement comme le ferait la route REST.

### 4.3 Redis Pub/Sub — Découplage événementiel

Canal unique : `sodalis_events`

Les producteurs (domus, labor) publient un message JSON structuré :
```json
{
  "type": "NEW_TASK",
  "coloc_id": "<uuid>",
  "message": "Nouvelle tâche assignée : Faire la vaisselle",
  "task_id": "<uuid>"
}
```

Concordia est le seul abonné. Le canal est unidirectionnel : les producteurs n'attendent aucune réponse.

---

## 5. Modèles de données

### service-domus — PostgreSQL

```sql
-- Enumération des rôles
CREATE TYPE user_role AS ENUM ('ADMIN', 'MEMBER');

CREATE TABLE colocs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    invite_code VARCHAR(20)  NOT NULL UNIQUE,  -- code lisible généré à la création
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    password   VARCHAR(255),                    -- bcrypt
    coloc_id   UUID REFERENCES colocs(id),      -- NULL si pas encore dans une coloc
    role       user_role NOT NULL DEFAULT 'MEMBER',
    harmony_score INT NOT NULL DEFAULT 0,       -- score de vie commune
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tickets de maintenance (ajoutés par migration)
CREATE TABLE maintenance_tickets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(150) NOT NULL,
    description TEXT,
    category    TEXT NOT NULL,   -- PLUMBING | ELECTRICITY | APPLIANCE | FURNITURE | INTERNET | OTHER
    priority    TEXT NOT NULL,   -- LOW | MEDIUM | HIGH | URGENT
    status      TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | IN_PROGRESS | RESOLVED | CANCELLED
    created_by  UUID NOT NULL REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),
    coloc_id    UUID NOT NULL REFERENCES colocs(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### service-labor — PostgreSQL

```sql
CREATE TYPE task_status AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(150) NOT NULL,
    assignee_id UUID NOT NULL,    -- pas de FK : domus est la source de vérité
    coloc_id    UUID NOT NULL,    -- idem
    status      task_status NOT NULL DEFAULT 'TODO',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at      TIMESTAMPTZ       -- date limite optionnelle
);
```

> **Note :** `assignee_id` et `coloc_id` dans `tasks` sont des UUIDs sans contrainte de clé étrangère locale. La vérification de cohérence est assurée par le RPC `VerifyUser` au moment de la création.

### service-concordia — MongoDB

```javascript
// Notification (document)
{
  coloc_id:   String,   // UUID de la coloc
  type:       String,   // type d'événement
  message:    String,   // message lisible
  created_at: Date      // TTL index possible
}
```

MongoDB est utilisé ici pour sa flexibilité de schéma : chaque type d'événement peut embarquer des champs supplémentaires (`task_id`, `ticket_id`, `poll_id`…) sans migration de schéma.

---

## 6. Sécurité et authentification

### Stratégie JWT distribuée

Chaque service valide le JWT de manière **autonome** avec le même `JWT_SECRET`. Il n'existe pas de service d'authentification centralisé.

```
Client → [Authorization: Bearer <token>] → gateway
                                              │
                                   décode JWT (vérif signature)
                                              │
                          passe le header tel quel aux services
                                              │
                          chaque service redécode et vérifie
```

**Payload JWT :**
```json
{ "id": "<uuid>", "email": "...", "coloc_id": "<uuid>", "role": "ADMIN|MEMBER" }
```

Quand un utilisateur crée ou rejoint une coloc, un **nouveau token est émis** contenant le `coloc_id` mis à jour. Cela évite un appel supplémentaire à domus à chaque requête pour lire le profil.

### Contrôle d'accès

Le gateway applique deux niveaux de contrôle dans chaque resolver :
1. **Authentification** : token présent et valide
2. **Appartenance** : `user.coloc_id === colocId` demandé (sauf `role === 'ADMIN'` qui bypasse)

Les services en aval font une vérification similaire sur leur propre middleware `auth.js` (copie identique dans chaque service).

---

## 7. Caching

Redis est utilisé comme cache applicatif pour la query `getColocDashboard`, qui agrège des données de trois services (domus, labor, concordia).

**Clé :** `dashboard_coloc_<colocId>`  
**TTL :** 30 secondes  
**Invalidation :** explicite sur chaque mutation qui modifie le contenu du dashboard (création de tâche, modification de ticket, vote de sondage, karma…)

```
GET getColocDashboard
  │
  ├── cache HIT  → retourne JSON depuis Redis
  └── cache MISS → appels parallèles (Promise.all) vers domus + labor + concordia
                   → agrège + sérialise → setEx(clé, 30, JSON)
```

L'invalidation est double :
- **Gateway** : `cache.del(cacheKey)` dans les resolvers de mutation
- **Services** : `publisher.del(dashboard_coloc_<coloc_id>)` dans service-labor et service-domus après chaque opération Redis

---

## 8. Notifications temps réel

Le flux complet d'une notification :

```
1. Mutation GraphQL → gateway → service-labor (ex: createTask)
2. service-labor insère en PostgreSQL
3. service-labor publie sur Redis :
     { type: "NEW_TASK", coloc_id: "...", message: "...", task_id: "..." }
4. service-concordia reçoit le message (subscriber)
5. service-concordia persiste en MongoDB (Notification.create)
6. service-concordia émet via Socket.io :
     io.emit("coloc_<coloc_id>_notifications", { type, message, task_id })
7. Tous les clients connectés à cette room reçoivent l'événement en temps réel
```

Le client peut également interroger l'historique :
```graphql
query {
  notifications(colocId: "...", page: 1, limit: 20) {
    data { type message created_at }
    pagination { total page limit }
  }
}
```

---

## 9. Choix stratégiques

### 9.1 Architecture microservices plutôt que monolithe

**Choix :** quatre services indépendants avec bases de données séparées.

**Justification :**
- Chaque service peut évoluer, se déployer et scaler indépendamment. La charge sur les tâches (labor) n'a pas d'impact sur la disponibilité de l'authentification (domus).
- Les pannes sont contenues : si concordia est indisponible, la création de tâches continue — les notifications sont simplement perdues pour la durée de la panne.
- La séparation des bases de données (`domus-db`, `labor-db`, MongoDB) évite tout couplage de schéma et permet d'optimiser chaque store pour son usage (relationnel strict vs document flexible).

**Compromis accepté :** complexité opérationnelle plus élevée qu'un monolithe, et cohérence éventuelle (pas de transactions distribuées entre services).

---

### 9.2 GraphQL comme unique point d'entrée

**Choix :** Apollo Server 5 en gateway, REST interne entre gateway et services.

**Justification :**
- Le client n'a qu'une URL à connaître et peut composer ses requêtes librement sans sur-fetching ni sous-fetching.
- Le schéma GraphQL constitue un contrat typé entre le frontend et le backend, documenté automatiquement via l'introspection.
- Le gateway est le seul composant exposé publiquement ; les services internes sont sur le réseau Docker et ne reçoivent que des requêtes du gateway.

**Compromis accepté :** le gateway est un point de défaillance unique (SPOF) côté accessibilité. Les appels en cascade (dashboard = 4 services appelés en parallèle) amplifient la latence en cas de lenteur d'un service en aval.

---

### 9.3 gRPC pour les appels inter-services synchrones

**Choix :** gRPC (protobuf) plutôt que HTTP/REST pour `VerifyUser` et `CreateTask`.

**Justification :**
- **Contrat strict :** le fichier `.proto` est la source de vérité partagée (`shared/`). Toute incompatibilité de format est détectée à la compilation, pas en production.
- **Performance :** encodage binaire protobuf plus léger et plus rapide que JSON pour des appels à haute fréquence (VerifyUser est appelé à chaque création de tâche).
- **Expressivité :** la définition du service RPC documente explicitement les capacités inter-services, contrairement à un appel REST implicite.

**Compromis accepté :** outillage plus lourd (proto compiler, grpc-js), débogage moins immédiat que du JSON visible dans curl.

---

### 9.4 Redis Pub/Sub pour le découplage événementiel

**Choix :** Redis Pub/Sub sur un canal unique `sodalis_events` plutôt qu'appels HTTP directs vers concordia.

**Justification :**
- **Découplage fort :** domus et labor ne savent pas que concordia existe. Ils publient un événement et n'attendent aucune réponse. Si concordia est redémarré, domus et labor continuent de fonctionner sans erreur.
- **Extensibilité :** ajouter un nouveau consommateur d'événements (ex: un service d'analytics) ne nécessite aucune modification des producteurs.
- **Simplicité :** Redis était déjà dans la stack pour le cache ; utiliser le Pub/Sub n'ajoute aucune dépendance supplémentaire.

**Compromis accepté :** Redis Pub/Sub est fire-and-forget — si concordia est down au moment de la publication, les messages sont perdus (pas de file persistante). Pour des garanties de livraison forte, il faudrait Redis Streams ou un message broker dédié (RabbitMQ, Kafka).

---

### 9.5 Base de données par service (Database-per-Service)

**Choix :** PostgreSQL dédié pour domus, PostgreSQL dédié pour labor, MongoDB pour concordia.

**Justification :**
- Aucun service ne peut lire directement la base d'un autre ; toutes les données inter-services transitent par les APIs et les contrats définis. Cela garantit l'encapsulation et facilite les évolutions de schéma indépendantes.
- Le choix de **MongoDB pour concordia** est délibéré : les notifications sont des documents à schéma variable (chaque type d'événement embarque des champs différents). MongoDB évite de maintenir un schéma relationnel extensible avec de nombreuses colonnes nullables.
- Les deux instances PostgreSQL séparées permettent de scaler le stockage des tâches sans affecter la base des utilisateurs.

---

### 9.6 JWT distribué sans service d'auth central

**Choix :** chaque service valide le JWT avec le même secret partagé (`JWT_SECRET`).

**Justification :**
- Pas de dépendance réseau supplémentaire pour la vérification : chaque service est autonome et peut valider un token même si domus est temporairement indisponible.
- Simplicité de déploiement : un seul secret à distribuer via variables d'environnement.

**Compromis accepté :** la révocation de token n'est pas possible sans liste noire (Redis) — un token volé est valide jusqu'à expiration (24h). Les nouveaux tokens (re-émis à chaque joinColoc / createColoc) coexistent avec les anciens jusqu'à leur expiration naturelle.

---

### 9.7 Invalidation de cache active plutôt que TTL seul

**Choix :** `cache.del(key)` explicite dans les mutations, en complément du TTL de 30 s.

**Justification :**
- Un TTL seul garantit une fraîcheur de 30 s maximum, mais un utilisateur pourrait voir un dashboard obsolète juste après avoir créé une tâche. L'invalidation explicite garantit la cohérence immédiate après une mutation.
- L'invalidation est aussi effectuée côté service (labor, domus) pour couvrir les cas où la mutation passe par un appel gRPC interne (escalade ticket URGENT) qui ne passe pas par le gateway.

---

### 9.8 CommonJS / Node.js sans TypeScript

**Choix :** JavaScript CommonJS pur, sans compilation ni TypeScript.

**Justification :**
- Réduction maximale de la friction au démarrage : aucun build step, `node index.js` suffit.
- L'ensemble de la stack (Express, Apollo, grpc-js, Mongoose) est nativement compatible CommonJS.
- La rigueur de typage est partiellement compensée par la validation explicite des entrées (`express-validator` dans domus) et les contrats protobuf (gRPC).

**Compromis accepté :** refactorings à grande échelle sont plus risqués sans le filet de sécurité du typage statique. Migration possible vers ESM/TypeScript si le projet grandit.
