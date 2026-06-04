# PokeVendor Complete File Inventory

## Documentation (Start Here!)

- **[DELIVERY.md](DELIVERY.md)** - Project delivery summary and what's included
- **[README.md](README.md)** - Project overview, features, and tech stack
- **[SETUP.md](SETUP.md)** - Installation guide and quick start
- **[ENHANCEMENTS.md](ENHANCEMENTS.md)** - Roadmap and recommended features
- **[FILES.md](FILES.md)** - This file (complete file listing)

## Backend (Express API)

### Configuration

- `apps/api/package.json` - Dependencies & scripts
- `apps/api/tsconfig.json` - TypeScript configuration
- `apps/api/.env.example` - Environment template
- `apps/api/Dockerfile` - Container image

### Source Code

- `apps/api/src/index.ts` - Server entry point, middleware, routes
- `apps/api/src/routes/cards.ts` - Card search & details endpoints
- `apps/api/src/routes/inventory.ts` - Inventory CRUD endpoints
- `apps/api/src/routes/deals.ts` - Deal management endpoints
- `apps/api/src/routes/locations.ts` - Location management endpoints

### Database

- `apps/api/src/lib/` - (utilities, to be populated)

## Frontend (React + Vite)

### Configuration

- `apps/web/package.json` - Dependencies & scripts
- `apps/web/tsconfig.json` - TypeScript configuration
- `apps/web/tsconfig.node.json` - TypeScript config for Vite
- `apps/web/vite.config.ts` - Vite build configuration
- `apps/web/index.html` - HTML entry point
- `apps/web/Dockerfile` - Container image

### Source Code

- `apps/web/src/App.tsx` - Main app with navigation
- `apps/web/src/main.tsx` - React DOM entry point
- `apps/web/src/App.css` - Dark theme styling
- `apps/web/src/components/CardThumbnail.tsx` - Card display component
- `apps/web/src/pages/CardSearch.tsx` - Card search page
- `apps/web/src/pages/InventoryPage.tsx` - Inventory tracker page
- `apps/web/src/pages/DealTrackerPage.tsx` - Deal tracker page
- `apps/web/src/lib/` - (utilities, to be populated)

## Database

- `prisma/schema.prisma` - Complete database schema
  - `Card` - Card metadata & references
  - `CardEmbedding` - Vector embeddings (future: scanning)
  - `CardHash` - Image hashes (future: scanning)
  - `PriceEntry` - Historical prices
  - `InventoryItem` - Your inventory tracking (with metadata)
  - `Deal` - Show transaction container
  - `DealItem` - Items in deals (cards, sealed, cash)
  - `DealLocation` - Custom locations
  - `Session` - Show event tracking

## Project Root

### Configuration

- `package.json` - Workspace root (npm workspaces)
- `docker-compose.yml` - Multi-service orchestration
- `.env.example` - Environment template
- `.gitignore` - Git ignore rules
- `.dockerignore` - Docker build ignore

### Scripts

- `scripts/init.sh` - Initialize project dependencies
- `scripts/seed.sh` - Seed database with sample data

---

## Getting Started

1. Read **[SETUP.md](SETUP.md)** for quick start
2. Run `docker compose up` to start all services
3. Visit http://localhost:3000 in your browser
4. See **[ENHANCEMENTS.md](ENHANCEMENTS.md)** for feature roadmap

---

## File Count Summary

- **Total files**: 50+
- **Documentation**: 5 markdown files
- **Backend code**: 4 route files + 1 server entry
- **Frontend code**: 3 pages + 1 component + 1 main
- **Configuration**: ~10 config files (JSON, YAML, TS)
- **Database**: 1 Prisma schema
- **Docker**: 3 Dockerfiles + 1 compose file

---

## Quick Reference: Where to Find Things

| Need                 | Location                                                             |
| -------------------- | -------------------------------------------------------------------- |
| Start here           | [SETUP.md](SETUP.md)                                                 |
| Add card search API  | [apps/api/src/routes/cards.ts](apps/api/src/routes/cards.ts)         |
| Edit inventory logic | [apps/api/src/routes/inventory.ts](apps/api/src/routes/inventory.ts) |
| Edit deal logic      | [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts)         |
| Change UI theme      | [apps/web/src/App.css](apps/web/src/App.css)                         |
| Update database      | [prisma/schema.prisma](prisma/schema.prisma)                         |
| Deploy setup         | [docker-compose.yml](docker-compose.yml)                             |
| Feature ideas        | [ENHANCEMENTS.md](ENHANCEMENTS.md)                                   |

---

## Next Steps

1. **Immediate**: Run `docker compose up` and test UI
2. **Soon**: Integrate real card data (TCGPlayer API)
3. **Next**: Add authentication if needed
4. **Later**: Pick features from [ENHANCEMENTS.md](ENHANCEMENTS.md)

See [DELIVERY.md](DELIVERY.md) for full project details!
