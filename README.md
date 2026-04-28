# Sodalis Backend

Backend de l'application de gestion de colocation **Sodalis**, construit en architecture microservices Node.js/Express.

## Architecture

```
Client (navigateur / app mobile)
        │
        ▼
  API Gateway :4000          ← seul point d'entrée (GraphQL)
   ┌────┴────┐
   ▼         ▼
service-   service-
domus      labor
:3001      :3002
   │    gRPC ↕
   └──────────┘
        │
        │  Redis Pub/Sub (sodalis_events)
        ▼
service-concordia :3003      ← notifications temps réel (Socket.io)
```

### Les 4 services

| Service | Port | Rôle | Base de données |
|---|---|---|---|
| `api-gateway` | 4000 | Proxy GraphQL, cache Redis | — |
| `service-domus` | 3001 | Utilisateurs, colocations, tickets de maintenance | PostgreSQL |
| `service-labor` | 3002 | Tâches | PostgreSQL |
| `service-concordia` | 3003 | Notifications temps réel | MongoDB |

### Modes de communication

- **HTTP / GraphQL** — Client → Gateway → Services
- **gRPC** — `service-labor → service-domus` (`VerifyUser`) et `service-domus → service-labor` (`CreateTask` pour les tickets urgents)
- **Redis Pub/Sub** — `service-domus` / `service-labor` publient sur le channel `sodalis_events` → `service-concordia` écoute et pousse via Socket.io

---

## Fonctionnalités

- Inscription et authentification JWT
- Création et gestion de colocations (code d'invitation)
- Gestion des tâches avec assignation à un membre
- **Tickets de maintenance** : création, suivi de statut, assignation (ADMIN), escalade automatique en tâche pour les priorités URGENT
- Notifications en temps réel via WebSocket
- Historique des notifications (MongoDB)
- Dashboard coloc mis en cache (Redis, TTL 30s)

---

## Prérequis

- [Docker](https://www.docker.com/) et Docker Compose
- Node.js 22+ (pour le développement local uniquement)

---

## Installation et démarrage

### 1. Variables d'environnement

```bash
cp .env.example .env
```

Ouvrir `.env` et renseigner au minimum `JWT_SECRET` et `POSTGRES_PASSWORD`.

### 2. Lancer toute l'infrastructure

```bash
docker-compose up -d --build
```

Les services démarrent dans cet ordre :
1. PostgreSQL (domus-db, labor-db), MongoDB, Redis
2. service-domus, service-labor, service-concordia
3. api-gateway

### 3. Accès

| Point d'accès | URL |
|---|---|
| API GraphQL | http://localhost:4000/graphql |
| service-domus (REST) | http://localhost:3001 |
| service-labor (REST) | http://localhost:3002 |
| service-concordia (REST + WS) | http://localhost:3003 |

### Reset complet (supprime toutes les données)

```bash
docker-compose down -v && docker-compose up -d --build
```

---

## Développement local

Chaque service peut être lancé indépendamment. Copier `.env.example` dans le dossier du service concerné et ajuster les URLs.

```bash
# Démarrer l'infrastructure Docker uniquement
docker-compose up -d domus-db labor-db redis concordia-db

# Lancer un service en mode watch
cd service-domus && npm run dev    # :3001 + gRPC :50051
cd service-labor && npm run dev    # :3002 + gRPC :50052
cd service-concordia && npm run dev # :3003
cd api-gateway && npm run dev      # :4000 — à démarrer en dernier
```

---

## API GraphQL

### Queries

```graphql
# Ma colocation (inclut invite_code)
myColoc: Coloc

# Dashboard complet d'une colocation (mis en cache)
getColocDashboard(colocId: ID!): Dashboard

# Liste des membres d'une colocation
usersByColoc(colocId: ID!): [User]

# Liste des tâches d'une colocation
tasksByColoc(colocId: ID!): [Task]

# Liste des tickets de maintenance
maintenanceTickets(colocId: ID!): [MaintenanceTicket]
```

### Mutations

```graphql
# Auth & Coloc
createColoc(name: String!): ColocWithToken
joinColoc(invite_code: String!): ColocWithToken

# Tâches
createTask(title: String!, assignee_id: ID!, coloc_id: ID!): Task
updateTaskStatus(id: ID!, status: String!): Task

# Tickets de maintenance
createMaintenanceTicket(
  title: String!
  description: String
  category: String!   # PLUMBING | ELECTRICITY | APPLIANCE | FURNITURE | INTERNET | OTHER
  priority: String!   # LOW | MEDIUM | HIGH | URGENT
  coloc_id: ID!
): MaintenanceTicket

updateTicketStatus(id: ID!, status: String!): MaintenanceTicket
# status: OPEN | IN_PROGRESS | RESOLVED | CANCELLED

assignTicket(id: ID!, assigned_to: ID!): MaintenanceTicket
# Réservé au rôle ADMIN
```

Toutes les requêtes (sauf inscription/login) nécessitent le header :
```
Authorization: Bearer <token>
```

---

## Événements Redis

Les services publient sur le channel `sodalis_events`. Service-concordia écoute et persiste chaque événement en MongoDB, puis l'émet via Socket.io sur la room `coloc_<coloc_id>_notifications`.

| Type d'événement | Publié par |
|---|---|
| `NEW_TASK` | service-labor |
| `TASK_UPDATED` | service-labor |
| `NEW_MAINTENANCE_TICKET` | service-domus |
| `MAINTENANCE_TICKET_UPDATED` | service-domus |
| `MAINTENANCE_TICKET_ASSIGNED` | service-domus |

### Écouter les notifications (Socket.io)

```javascript
const socket = io('http://localhost:3003');
socket.on(`coloc_<colocId>_notifications`, (event) => {
  console.log(event.type, event.message);
});
```

---

## Variables d'environnement

| Variable | Services | Description |
|---|---|---|
| `JWT_SECRET` | tous | Clé de signature JWT (identique sur tous les services) |
| `POSTGRES_USER` | domus-db, labor-db | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | domus-db, labor-db | Mot de passe PostgreSQL |
| `POSTGRES_DB` | domus-db | Nom de la base domus |
| `REDIS_URL` | domus, labor, concordia, gateway | URL Redis |
| `MONGO_URL` | concordia | URL MongoDB |
| `GRPC_PORT` | domus | Port du serveur gRPC domus (défaut : 50051) |
| `LABOR_GRPC_PORT` | labor | Port du serveur gRPC labor (défaut : 50052) |
| `LABOR_GRPC_URL` | domus | Adresse du serveur gRPC labor |
| `DOMUS_GRPC_URL` | labor | Adresse du serveur gRPC domus |
| `DOMUS_URL` | gateway | URL HTTP de service-domus |
| `LABOR_URL` | gateway | URL HTTP de service-labor |
| `CORS_ORIGINS` | concordia, gateway | Allowlist d'origines CORS (séparées par virgules). Prioritaire sur `CORS_ORIGIN`. |
| `CORS_ORIGIN` | concordia, gateway | Origine autorisée pour CORS (fallback rétrocompatible si `CORS_ORIGINS` est vide). |

---

## Structure du projet

```
sodalis-backend/
├── api-gateway/          # Proxy GraphQL (Apollo Server 5)
├── service-domus/        # REST + gRPC server (utilisateurs, colocs, maintenance)
├── service-labor/        # REST + gRPC server (tâches)
├── service-concordia/    # Abonné Redis + Socket.io (notifications)
├── shared/
│   ├── domus.proto       # Contrat gRPC DomusService (VerifyUser)
│   └── labor.proto       # Contrat gRPC LaborService (CreateTask)
├── docker-compose.yml
├── .env.example
└── testing_guide.md
```
