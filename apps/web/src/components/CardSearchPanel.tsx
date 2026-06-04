import { useEffect, useState } from "react";
import type { FC } from "react";
import axios from "axios";
import { CardThumbnail } from "./CardThumbnail";

interface SearchCardData {
  name?: string;
  number?: string;
  images?: {
    small?: string;
    large?: string;
  };
}

export interface SearchCard {
  id: string;
  data: SearchCardData;
  tcgPlayerId?: string | null;
}

type PriceValue = number | string | null;

interface CardPriceData {
  prices: { nm: PriceValue; lp: PriceValue; mp: PriceValue } | null;
  tcgUrl: string | null;
}

type Condition = "nm" | "lp" | "mp";

const CONDITION_LABELS: Record<Condition, string> = {
  nm: "Near Mint",
  lp: "Lightly Played",
  mp: "Moderately Played",
};

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

interface CardSearchPanelProps {
  title: string;
  description?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  disabledMessage?: string;
  addLabel?: string;
  onCardSelect: (card: SearchCard, price?: number) => void | Promise<void>;
  onCardSelected?: (card: SearchCard) => void;
}

export const CardSearchPanel: FC<CardSearchPanelProps> = ({
  title,
  description,
  searchPlaceholder = "Search by name or card number...",
  emptyMessage = "No cards found",
  disabled = false,
  disabledMessage,
  addLabel = "Add Card",
  onCardSelect,
  onCardSelected,
}) => {
  const pageSize = 40;
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<SearchCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"dateDesc" | "dateAsc">("dateDesc");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Price-picker state
  const [selectedCard, setSelectedCard] = useState<SearchCard | null>(null);
  const [priceData, setPriceData] = useState<CardPriceData | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [condition, setCondition] = useState<Condition>("nm");

  useEffect(() => {
    if (disabled || !query.trim()) {
      setCards([]);
      setTotal(0);
      return;
    }

    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await axios.get("/api/cards/search", {
          params: {
            q: query,
            limit: pageSize,
            offset: (page - 1) * pageSize,
            sortBy,
          },
        });
        setCards(response.data.cards || []);
        setTotal(response.data.total || 0);
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(handle);
  }, [disabled, page, query, sortBy]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleCardClick = async (card: SearchCard) => {
    // If same card is clicked again, deselect it
    if (selectedCard?.id === card.id) {
      setSelectedCard(null);
      setPriceData(null);
      return;
    }

    setSelectedCard(card);
    onCardSelected?.(card);
    setPriceData(null);
    setCondition("nm");
    setPriceLoading(true);

    try {
      const res = await axios.get<CardPriceData>(
        `/api/cards/${card.id}/prices`,
      );
      setPriceData(res.data);
    } catch {
      setPriceData({
        prices: null,
        tcgUrl: card.tcgPlayerId
          ? `https://www.tcgplayer.com/product/${card.tcgPlayerId}`
          : null,
      });
    } finally {
      setPriceLoading(false);
    }
  };

  const selectedPrice =
    toFiniteNumber(priceData?.prices?.[condition]) ?? undefined;

  let addBtnLabel = addLabel;
  if (submitting) {
    addBtnLabel = "Adding…";
  } else if (selectedPrice != null) {
    addBtnLabel = `${addLabel} @ $${selectedPrice.toFixed(2)}`;
  }

  const handleAdd = async () => {
    if (!selectedCard) return;
    setSubmitting(true);
    try {
      await onCardSelect(selectedCard, selectedPrice);
      // Clear selection after successful add
      setSelectedCard(null);
      setPriceData(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card-search-panel">
      <div className="search-panel-header">
        <div>
          <h2>{title}</h2>
          {description && <p className="panel-description">{description}</p>}
        </div>
      </div>

      <div className="card-search">
        <div className="search-controls">
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
              setSelectedCard(null);
              setPriceData(null);
            }}
            className="search-input"
            disabled={disabled}
          />

          <select
            className="search-sort"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as "dateDesc" | "dateAsc");
              setPage(1);
            }}
            disabled={disabled}
          >
            <option value="dateDesc">Newest Release</option>
            <option value="dateAsc">Oldest Release</option>
          </select>
        </div>

        {disabled && disabledMessage && (
          <div className="search-status-banner">{disabledMessage}</div>
        )}

        {/* Price picker panel — shown when a card is selected */}
        {selectedCard && (
          <div className="price-picker-panel">
            <div className="price-picker-card-info">
              {selectedCard.data.images?.small && (
                <img
                  src={selectedCard.data.images.small}
                  alt={selectedCard.data.name}
                  className="price-picker-thumb"
                />
              )}
              <div className="price-picker-details">
                <div className="price-picker-name">
                  {selectedCard.data.name ?? selectedCard.id}
                  {selectedCard.data.number && (
                    <span className="price-picker-number">
                      {" "}
                      #{selectedCard.data.number}
                    </span>
                  )}
                </div>
                {priceData?.tcgUrl && (
                  <a
                    href={priceData.tcgUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tcgplayer-link"
                  >
                    View on TCGPlayer ↗
                  </a>
                )}

                {priceLoading && (
                  <div className="price-loading">Loading market prices…</div>
                )}

                {!priceLoading && priceData && (
                  <>
                    <div className="condition-tabs">
                      {(["nm", "lp", "mp"] as Condition[]).map((c) =>
                        (() => {
                          const conditionPrice = toFiniteNumber(
                            priceData.prices?.[c],
                          );
                          return (
                            <button
                              key={c}
                              type="button"
                              className={`condition-tab${condition === c ? " active" : ""}`}
                              onClick={() => setCondition(c)}
                            >
                              <span className="condition-abbr">
                                {c.toUpperCase()}
                              </span>
                              <span className="condition-price">
                                {conditionPrice === null
                                  ? "—"
                                  : `$${conditionPrice.toFixed(2)}`}
                              </span>
                            </button>
                          );
                        })(),
                      )}
                    </div>
                    <div className="condition-full-name">
                      {CONDITION_LABELS[condition]}
                      {selectedPrice != null && (
                        <span className="condition-market-note">
                          {" "}
                          · market price
                        </span>
                      )}
                    </div>
                  </>
                )}

                {!priceLoading && !priceData && (
                  <div className="price-unavailable">
                    Price data unavailable
                  </div>
                )}
              </div>
            </div>

            <div className="price-picker-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelectedCard(null);
                  setPriceData(null);
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleAdd()}
                disabled={submitting}
              >
                {addBtnLabel}
              </button>
            </div>
          </div>
        )}

        {loading && <div className="loading">Searching...</div>}

        {!loading && query && total > 0 && (
          <div className="search-meta">
            Showing {(page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, total)} of {total}
          </div>
        )}

        <div className="cards-grid">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`search-card-wrapper${selectedCard?.id === card.id ? " selected" : ""}`}
            >
              <CardThumbnail
                id={card.id}
                name={card.data.name || "Unknown"}
                image={card.data?.images?.small || card.data?.images?.large}
                onClick={() => {
                  void handleCardClick(card);
                }}
              />
              <div className="search-card-meta">
                <span>
                  {card.data?.number ? `#${card.data.number}` : card.id}
                </span>
              </div>
            </div>
          ))}
        </div>

        {!loading && !disabled && cards.length === 0 && query && (
          <div className="no-results">{emptyMessage}</div>
        )}

        {!loading && total > pageSize && (
          <div className="pagination-controls">
            <button
              type="button"
              className="page-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </button>
            <span className="page-indicator">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="page-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
