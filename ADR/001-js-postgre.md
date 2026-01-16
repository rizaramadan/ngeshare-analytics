# ADR 001 — Use JavaScript (Node.js) and PostgreSQL

**Status**: Accepted

**Deciders:** Core engineering team

**Date:** 2026-01-16

## Context

We are building an MVP-grade backend for Ngeshare where rapid iteration, broad ecosystem support, and operational simplicity are priorities. The team is most productive in the JavaScript ecosystem, and we expect a relational database with strong ACID guarantees, good tooling for migrations, and broad hosting support.

## Decision

We will implement the backend using JavaScript running on Node.js and PostgreSQL as the primary relational database.

We will keep the server implementation idiomatic JavaScript (Node 18+ runtime recommended) and use a proven PostgreSQL driver (for example `pg`) and a lightweight migration tool (e.g., `node-pg-migrate` or equivalent). If/when we decide to add an ORM or stronger typing, we will evaluate Prisma or TypeORM, but the baseline decision is JS + Postgres.

## Rationale

- Developer familiarity: the team has strong JavaScript experience which minimizes onboarding friction and accelerates delivery.
- Ecosystem: Node.js has mature PostgreSQL clients and many battle-tested libraries for web frameworks, testing, and deployment.
- Postgres capabilities: full relational features, strong consistency, advanced indexing, JSONB support for semi-structured data, and mature tooling for backups and replication.
- Operational fit: PostgreSQL is widely supported by hosting providers and managed DB services (e.g., Supabase, AWS RDS, DigitalOcean Managed Databases), simplifying production operations.
- Speed of iteration: sticking to JavaScript lets us iterate quickly for the MVP without introducing cross-language complexity.

## Consequences

- Short-term: fast development and fewer context switches for the team.
- Long-term: some trade-offs in type-safety when staying with plain JavaScript; we can migrate to TypeScript progressively if needed.
- We will need to establish good practices around migrations, connection pooling, backups, monitoring, and schema design to avoid operational issues.
- Tooling choices (driver, migration tool, optional ORM) should be decided and documented in a follow-up task.

## Alternatives Considered

- TypeScript + PostgreSQL: provides stronger typing up-front. Rejected for now to prioritize speed; revisit as the codebase matures.
- JavaScript + MySQL: considered, but Postgres provides better JSON support and features we expect to use.
- NoSQL (e.g., MongoDB): rejected because relational model and transactions are important for our early requirements.

## Implementation Notes / Next Steps

- Use Node.js 24+ runtime baseline.
- Start with the `pg` driver for PostgreSQL connections and `node-pg-migrate` (or similar) for schema migrations.
- Configure connection pooling and environment-driven connection settings (`DATABASE_URL` or host/port/user/password) and document required env vars.
- Add a documented migration and backup strategy; enable automated backups in production DB and configure monitoring/alerts.
- Re-evaluate adopting TypeScript and/or an ORM (Prisma) once the schema stabilizes or if developer productivity would benefit.

## Authors

Engineering team

---

File: [ADR/001-js-postgre.md](ADR/001-js-postgre.md)

