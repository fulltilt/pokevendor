import React, { useState, useEffect } from "react";
import axios from "axios";
import { CardThumbnail } from "../components/CardThumbnail";

interface Card {
  id: string;
  data: any;
  tcgPlayerId?: string;
}

export const CardSearch: React.FC = () => {
  const pageSize = 40;
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"dateDesc" | "dateAsc">("dateDesc");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
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
  }, [query, page, sortBy]);

  const handleCardClick = (cardId: string) => {
    console.log("Card clicked:", cardId);
    // TODO: Implement add to inventory/deal flow
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="card-search">
      <div className="search-controls">
        <input
          type="text"
          placeholder="Search by name or card number..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          className="search-input"
        />

        <select
          className="search-sort"
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as "dateDesc" | "dateAsc");
            setPage(1);
          }}
        >
          <option value="dateDesc">Newest Release</option>
          <option value="dateAsc">Oldest Release</option>
        </select>
      </div>

      {loading && <div className="loading">Searching...</div>}

      {!loading && query && total > 0 && (
        <div className="search-meta">
          Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}{" "}
          of {total}
        </div>
      )}

      <div className="cards-grid">
        {cards.map((card) => (
          <CardThumbnail
            key={card.id}
            id={card.id}
            name={card.data.name || "Unknown"}
            image={card.data?.images?.small || card.data?.images?.large}
            onClick={handleCardClick}
          />
        ))}
      </div>

      {!loading && cards.length === 0 && query && (
        <div className="no-results">No cards found</div>
      )}

      {!loading && total > pageSize && (
        <div className="pagination-controls">
          <button
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
            className="page-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
