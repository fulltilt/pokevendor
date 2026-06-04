# Suggested Enhancements & Roadmap

Based on your requirements, here are features and improvements not yet implemented but worth considering:

## Phase 1: MVP Polish (High Priority)

### Card Data Integration

- **TCGPlayer API**: Auto-fetch prices at `https://infinite-api.tcgplayer.com/price/history/{tcgPlayerId}/detailed?range=month`
- **Cron job**: Daily price refresh for cards in inventory
- **Bulk import**: CSV/Excel upload to seed initial card database
- Recommendation: Store price history in `PriceEntry` model for trending analysis

### UI/UX Improvements

- **Double-click edit**: Edit quantity/price directly on inventory & deal items (already noted in schema)
- **Quick-add modal**: Click card → instant modal to set storage type + purchase price (no modal, just quick API call)
- **Keyboard shortcuts**: Ctrl+S to search, Tab to navigate cards, Enter to add
- **Undo/redo**: Maintain action history for deal modifications
- **Persistent session**: Save active deal to localStorage; resume if browser crashes

### Inventory Enhancements

- **Bulk operations**: Select multiple cards → batch update storage type or mark as sold
- **Search within inventory**: Filter by card name, purchase date range, price range
- **Alerts**: Flag cards that exceed/fall below custom price thresholds
- **Variance tracking**: Show profit/loss on sold items

---

## Phase 2: Show Management (High Priority)

### Deal Session Context

- **Session model** already in schema; use to track multi-deal show events
- **Set location/date once**: Apply to all deals in current session (broadcast state)
- **End session**: Auto-save, calculate show totals (total cash in/out, inventory added)

### Show Performance Dashboard

- Show summary: Total deals, net cash, cards added to inventory, sealed product in
- Cards by volume: Which cards moved most during show
- Profit analysis: Best performing cards, hot deals
- Time tracking: How long deals took

### Reporting & Export

- **CSV export**: All inventory, all deals (for accounting/taxes)
- **PDF receipt**: Generate receipt per deal (buyer/seller, items, total)
- **Tax year report**: Sum of cost basis vs realized gains
- **Bulk email**: Send deal recaps to trading partners

---

## Phase 3: Data Enrichment (Medium Priority)

### Image & Vector Search (leveraging pgvector & future embeddings)

- **Card scanning**: Upload photo → vector search to match card ID
- **Set ID detection**: Use OCR/ML to extract set/rarity from image
- **Variant matching**: Find exact print variant from photo
- **Implementation**: Use CLIP embeddings + pgvector similarity search

### Market Intelligence

- **Price trends**: Show charts of card value over time
- **Rarity matrix**: Cards gaining/losing value in your area
- **Trading signals**: Recommend buys/sells based on momentum
- **Integration**: Pull data from TCGPlayer, eBay, StockX APIs

---

## Phase 4: Multi-User & Scaling (Lower Priority)

### Authentication & Collaboration

- **User accounts**: Login, separate inventory per user
- **Sharing deals**: Invite users to deal for group trading
- **Role-based access**: Viewer, editor, admin
- **API keys**: Allow third-party integrations

### Mobile Experience

- **Progressive Web App (PWA)**: Works offline, add-to-home-screen
- **React Native**: iOS/Android companion app for on-show lookups
- **QR codes**: Generate QR per deal for quick sharing with trading partner
- **Push notifications**: Alert when card price changes significantly

---

## Recommended Quick Wins (Next 1-2 Weeks)

1. **Price sync endpoint**: `POST /api/cards/:id/sync-prices` → calls TCGPlayer, updates PriceEntry
2. **Inventory search**: Add text search with fuzzy matching (e.g., "pika chu" → Pikachu)
3. **Deal item UI**: Drag-and-drop to move cards between incoming/outgoing
4. **Modal editor**: Double-click card in deal → inline editor for quantity/price
5. **Saved locations**: Pre-populate with "Facebook Marketplace", "Reddit", "eBay", "Local Meet"
6. **Export inventory**: "Download as CSV" button on inventory page

---

## Technical Debt & Considerations

### Security

- [ ] Add authentication (JWT or OAuth)
- [ ] Validate/sanitize all inputs on backend
- [ ] Rate limit API endpoints
- [ ] HTTPS in production (use TLS termination proxy)

### Performance

- [ ] Add pagination to inventory/deals lists (already in API, need UI)
- [ ] Index database queries on frequently filtered columns (done in schema)
- [ ] Cache card data in Redis (for price lookups)
- [ ] Lazy-load card images

### Testing

- [ ] Add Jest unit tests for API routes
- [ ] Add Playwright E2E tests for UI flows
- [ ] Test deal finalization logic thoroughly
- [ ] CI/CD pipeline (GitHub Actions)

### DevOps

- [ ] Remove `version` attribute from docker-compose.yml (deprecated)
- [ ] Add health checks to API service
- [ ] Use named volumes instead of bind mounts for production
- [ ] Add `.env.production` example with secure defaults
- [ ] Document database backup strategy

---

## Data Model Refinements (Optional)

### Add to schema if needed:

```prisma
model Note {
  id        String @id @default(cuid())
  cardId    String?
  dealId    String?
  text      String
  createdAt DateTime @default(now())
  card      Card? @relation(fields: [cardId], references: [id])
  deal      Deal? @relation(fields: [dealId], references: [id])
}

model PriceAlert {
  id        String @id @default(cuid())
  cardId    String
  threshold Float
  type      String // "above" or "below"
  active    Boolean @default(true)
  card      Card @relation(fields: [cardId], references: [id])
}

model TradingPartner {
  id    String @id @default(cuid())
  name  String
  email String?
  phone String?
  notes String?
}
```

---

## File Organization (Future)

When adding more features, consider:

```
apps/api/
├── src/
│   ├── middleware/          (auth, validation)
│   ├── services/            (business logic)
│   ├── utils/               (helpers, constants)
│   └── routes/              (API endpoints)

apps/web/
├── src/
│   ├── components/          (reusable UI)
│   ├── pages/               (full pages)
│   ├── hooks/               (custom React hooks)
│   ├── services/            (API client)
│   └── styles/              (CSS modules)
```

---

## Questions to Consider

1. **Card database**: Will you import from TCGPlayer API, use existing db, or populate manually?
2. **Multi-user**: Solo use, or eventually share with trading partners?
3. **Mobile**: Show lookup only, or full deal entry on phone?
4. **Marketplace sync**: Auto-list sold cards on eBay/TCGPlayer, or manual only?
5. **Grading**: Track card condition (PSA 9, etc.), or just quantity/price?

Choose features that align with your immediate show needs, then iterate!
