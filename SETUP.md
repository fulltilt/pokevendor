## Quick Start Guide

### Prerequisites

- **Docker** & **Docker Compose** installed
- **Node.js 22+** for local development (optional, not needed if using Docker)

### Option 1: Run with Docker (Recommended)

```bash
cd pokevendor
docker compose up
```

This starts three services:

- **PostgreSQL + pgvector** on `localhost:5432`
- **Express API** on `localhost:3001`
- **React Frontend** on `localhost:3000`

The database will initialize automatically. Visit **http://localhost:3000** in your browser.

### Option 2: Local Development

#### Setup Backend

```bash
cd apps/api
npm install
npx prisma db push     # Initialize database (requires running Postgres)
npm run dev
```

#### Setup Frontend (in another terminal)

```bash
cd apps/web
npm install
npm run dev
```

### Database Setup (First Time)

If using Docker, migrations run automatically. For local:

```bash
cd apps/api
npx prisma db push      # Push schema to database
npx prisma generate     # Generate Prisma client
npm run db:seed         # Optional: seed sample data
```

### Environment Variables

Copy `.env.example` to `.env` in `apps/api/`:

```
DATABASE_URL="postgresql://pokevendor:pokevendor@localhost:5432/pokevendor"
PORT=3001
NODE_ENV=development
```

### Common Commands

From project root:

```bash
npm run dev              # Run both API and web locally
npm run build            # Build for production
npm run db:push          # Push schema changes
npm run db:migrate       # Create and apply migrations
```

---

## Features Overview

### Card Search

- Search bar with live results
- Small card thumbnails (many per line)
- Price display from TCGPlayer integration

### Inventory Tracker

- Click card to add to inventory
- Track: quantity, purchase price, purchase date, storage type (in case / not in case)
- Filter by storage type
- Display total inventory value
- Update/delete cards

### Deal Tracker

- Create deals at specific locations
- Add incoming/outgoing items (cards, sealed, cash)
- Edit quantity and price by double-clicking
- See running totals for incoming vs outgoing
- Calculate net cash position (positive/negative)
- Finalize deals and auto-add cards to inventory

---

## Architecture

### Backend (Express + Prisma)

- REST API with CORS enabled
- Prisma ORM with PostgreSQL
- Routes: cards, inventory, deals, locations

### Frontend (React + Vite)

- Dark mode UI (tailored for show environments)
- Component-based architecture
- Axios for API calls
- No external UI library (custom CSS for minimal bundle)

### Database (PostgreSQL + pgvector)

- Stores cards, inventory items, deals
- pgvector extension for future card scanning
- Full-text search ready

---

## API Quick Reference

### Cards

```
GET  /api/cards/search?q=pikachu        Search cards
GET  /api/cards/:id                     Card details
```

### Inventory

```
GET  /api/inventory?storageType=in_case   List (with filter)
POST /api/inventory                       Add card
PATCH /api/inventory/:id                  Update card
DELETE /api/inventory/:id                 Remove card
```

### Deals

```
GET  /api/deals                           List deals
POST /api/deals                           Create deal
GET  /api/deals/:dealId                   Deal details
POST /api/deals/:dealId/items             Add item
PATCH /api/deals/items/:itemId            Update quantity/price
POST /api/deals/:dealId/finalize          Close deal
```

### Locations

```
GET  /api/locations                       List all
POST /api/locations                       Create new location
```

---

## Troubleshooting

### Docker won't start

- Ensure Docker daemon is running: `docker ps`
- Check ports are available: `lsof -i :3000`, `lsof -i :3001`, `lsof -i :5432`

### Database connection error

- Verify `DATABASE_URL` matches your setup
- For Docker: use `db` as hostname (internal network)
- For local: use `localhost`

### API not responding

- Check `npm run dev` is running the API
- Verify `http://localhost:3001/health` returns `{"status":"ok"}`

### Frontend shows "Cannot GET /api/cards"

- API and web must be on same origin or CORS must be enabled
- Docker Compose handles this automatically
- Local dev: frontend proxies to `http://localhost:3001`

---

## Next Steps

1. **Populate card data**: Integrate with TCGPlayer API to seed cards
2. **Authentication**: Add user login for multi-user scenarios
3. **Mobile**: Build React Native or responsive PWA version
4. **Image upload**: Add photo verification for cards
5. **Reporting**: Create analytics dashboard for show performance
6. **Export**: Add CSV export for tax/accounting purposes

---

## Support

Check individual `README.md` in `apps/api` and `apps/web` for detailed docs.
