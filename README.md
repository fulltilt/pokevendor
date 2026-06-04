# PokeVendor - Card Inventory & Deal Tracker

A full-stack application for tracking Pokémon card inventory and managing trades at card shows.

## Features

- **Card Search**: Search for cards with similar layout to collectr.com
- **Inventory Tracker**: Track cards with detailed metadata (purchase price, date, location, etc.)
- **Deal Tracker**: Create deals with incoming/outgoing items, track net cash, manage locations
- **Dark Mode UI**: Modern, dark-themed interface optimized for show environments
- **Responsive Grid**: Many cards per line for quick lookup

## Project Structure

```
pokevendor/
├── apps/
│   ├── api/          # Express backend
│   └── web/          # React + Vite frontend
├── prisma/           # Database schema
├── docker-compose.yml
└── README.md
```

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 22+ (for local development)
- PostgreSQL 16+ with pgvector (included in Docker)

### Quick Start with Docker

```bash
docker-compose up
```

This will start:

- **Frontend**: http://localhost:3000
- **API**: http://localhost:3001
- **Database**: PostgreSQL on port 5432

### Local Development

#### Backend Setup

```bash
cd apps/api
npm install
npx prisma db push
npm run dev
```

#### Frontend Setup

```bash
cd apps/web
npm install
npm run dev
```

## Database Schema

### Card

- `id`: Card identifier
- `data`: JSON metadata
- `tcgPlayerId`: TCGPlayer ID for price lookups
- `embedding`: Vector embedding (future: card scanning)

### InventoryItem

Tracks individual cards with metadata:

- `quantity`, `storageType` (in_case/not_in_case)
- `pricePurchasedAt`, `purchasedAt`, `purchasedFrom`
- `priceCurrentAsk`, `priceSold`, `soldAt`, `soldTo`

### Deal

Manages show trades:

- `location`: Where the deal occurs
- `incoming`/`outgoing`: List of items
- `status`: pending/finalized

### DealItem

Individual items in a deal:

- Supports cards, sealed product, and cash
- Quantity and price tracking

### DealLocation

Custom locations (e.g., "East Bay Card Show", "Facebook Marketplace")

## API Endpoints

### Cards

- `GET /api/cards/search?q=<query>` - Search cards
- `GET /api/cards/:id` - Get card details

### Inventory

- `GET /api/inventory` - List inventory (filterable by storageType)
- `POST /api/inventory` - Add item
- `PATCH /api/inventory/:id` - Update item
- `DELETE /api/inventory/:id` - Remove item

### Deals

- `GET /api/deals` - List deals
- `POST /api/deals` - Create deal
- `GET /api/deals/:dealId` - Get deal details
- `POST /api/deals/:dealId/items` - Add item
- `PATCH /api/deals/items/:itemId` - Update item quantity/price
- `POST /api/deals/:dealId/finalize` - Finalize deal

### Locations

- `GET /api/locations` - List locations
- `POST /api/locations` - Create location

## Environment Variables

### Backend (.env)

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
PORT=3001
NODE_ENV=development
```

### Frontend

Auto-proxies to `http://localhost:3001/api`

## Database Transfer (Export/Import)

To transfer this project and all its data to another laptop:

### On the Source Laptop

Create a compressed database dump:

```bash
npm run db:backup
```

This creates a `.sql.gz` file in the `backups/` directory with a timestamp. Copy this file to your destination laptop.

### On the Destination Laptop

After cloning the repo and copying the backup file:

1. Start the database service:

```bash
docker compose up -d db
```

2. Wait for the database to be healthy (check with `docker compose ps`).

3. Restore from the backup file:

```bash
npm run db:restore -- backups/your-backup-file.sql.gz
```

Or restore the most recent backup automatically:

```bash
npm run db:restore
```

4. Start the full application:

```bash
docker compose up
```

Your inventory, deals, and all card data will be restored.

## Price Integration

To integrate TCGPlayer prices, fetch from:

```
https://infinite-api.tcgplayer.com/price/history/{tcgPlayerId}/detailed?range=month
```

Example: https://infinite-api.tcgplayer.com/price/history/676096/detailed?range=month

## Future Enhancements

- Card scanning via image embedding + pgvector
- TCGPlayer price sync automation
- Multi-user support with authentication
- Export/reporting for tax or collection tracking
- Photo upload for card verification
- Batch import from CSV/Excel
- Mobile app for on-the-go deal tracking
- Analytics dashboard (show performance, trending cards)
- Wishlist/buying guide
- Integration with other marketplaces (eBay, StockX, etc.)

## License

MIT
