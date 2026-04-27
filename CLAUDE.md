# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Each service is independent. Run commands from within the relevant service directory.

```bash
# Start a service in dev mode (auto-reload via nodemon)
cd service-domus && npm run dev    # port 3001 + gRPC port 50051
cd service-labor && npm run dev    # port 3002
cd service-concordia && npm run dev # port 3003
cd api-gateway && npm run dev      # port 4000 — start this last

# Start all infrastructure (PostgreSQL x2, MongoDB, Redis)
docker-compose up -d

# Stop and wipe all volumes (full reset)
docker-compose down -v
```

There is no test runner configured. Refer to `testing_guide.md` for a manual end-to-end test scenario.

## Environment

Copy `.env.example` to `.env` at the repo root and fill in the required variables. The `docker-compose.yml` reads from this root `.env` file. Each service also reads its own `.env` via `dotenv`.

Key env vars each service expects:

| Variable | Used by |
|---|---|
| `JWT_SECRET` | All services (must be identical) |
| `DATABASE_URL` / `POSTGRES_*` | domus, labor |
| `GRPC_PORT` | domus (default 50051) |
| `GRPC_HOST` | labor (points to domus) |
| `REDIS_URL` | labor, concordia, api-gateway |
| `MONGO_URL` | concordia |
| `DOMUS_URL` / `LABOR_URL` | api-gateway (HTTP base URLs) |

## Architecture

**Sodalis** is a flatmate management app built as four independent Node.js/Express microservices (CommonJS, no TypeScript).

```
Client
  └─► API Gateway :4000  (GraphQL — Apollo Server 5)
        ├─► service-domus :3001  (REST — users, colocs, auth)
        └─► service-labor :3002  (REST — tasks)
                └─► service-domus :50051  (gRPC — VerifyUser)
                └─► Redis pub/sub  ──► service-concordia :3003
                                          ├─ MongoDB (persist notifications)
                                          └─ Socket.io (real-time push)
```

### service-domus

The source of truth for users and colocations. Runs two servers simultaneously:
- **Express REST** on `PORT` (default 3001) — routes in `routes/`
- **gRPC server** on `GRPC_PORT` (default 50051) — exposes a single `VerifyUser` RPC defined in `shared/domus.proto`

The `VerifyUser` RPC checks that a `user_id` belongs to a given `coloc_id` in PostgreSQL. DB schema is in `db-init/01-init.sql` (tables: `colocs`, `users`; enum: `user_role`).

JWT payload shape: `{ id, email, coloc_id, role }`.

### service-labor

Manages tasks. On `POST /tasks`:
1. Calls `VerifyUser` via gRPC to confirm the assignee belongs to the coloc.
2. Inserts the task in its own PostgreSQL DB (`db-init/01-init.sql`, table: `tasks`, enum: `task_status`).
3. Publishes a `NEW_TASK` event to Redis channel `sodalis_events`.
4. Deletes the Redis cache key `dashboard_coloc_<coloc_id>` to invalidate the gateway cache.

The gRPC client is in `grpc-client.js`; the Redis publisher is in `redis-publisher.js`.

### service-concordia

No own database for routes — it is purely event-driven. Subscribes to the `sodalis_events` Redis channel:
- Persists each event as a `Notification` document in MongoDB (`models/Notification.js`).
- Emits a Socket.io event `coloc_<coloc_id>_notifications` to all connected clients.

Exposes one REST endpoint: `GET /notifications/coloc/:id` (returns last 20 notifications).

### api-gateway

Thin GraphQL proxy. No own database. Resolvers in `resolvers.js`:
- Forward requests to domus/labor via `axios`, passing the original `Authorization` header.
- Cache `getColocDashboard` in Redis for 30 seconds (key: `dashboard_coloc_<colocId>`).
- Authorization is checked by verifying the JWT and comparing `user.coloc_id` to the requested `colocId` (ADMINs bypass).

### Shared

`shared/domus.proto` is the single source of truth for the gRPC contract. Both `service-domus/grpc-server.js` and `service-labor/grpc-client.js` load it with a relative path (`../shared/domus.proto`).

### Auth pattern

Every service re-validates the JWT independently using the same `JWT_SECRET`. The middleware is copy-pasted in each service (`middleware/auth.js`) — there is no shared auth library. The gateway decodes the token in its Apollo context and enforces ownership in each resolver.
