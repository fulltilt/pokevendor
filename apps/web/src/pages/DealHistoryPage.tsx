import { useEffect, useState, Fragment } from "react";
import type { FC } from "react";
import axios from "axios";

type SortBy = "dateDesc" | "dateAsc" | "location";
type View = "deals" | "analytics";

interface DealCardData {
  name?: string;
  number?: string;
  images?: { small?: string };
  set?: { name?: string };
}

interface DealItemDetail {
  id: string;
  direction: string;
  quantity: number;
  price: number;
  itemType: string;
  notes?: string | null;
  card?: { data: DealCardData } | null;
}

interface DealSummary {
  id: string;
  location?: string | null;
  dateFinalized?: string | null;
  dateCreated: string;
  notes?: string | null;
  incomingTotal: number;
  outgoingTotal: number;
  netCash: number;
  incoming: DealItemDetail[];
  outgoing: DealItemDetail[];
}

interface LocationAnalytic {
  location: string;
  dealCount: number;
  totalIncoming: number;
  totalOutgoing: number;
  totalNetCash: number;
  avgNetCash: number;
  lastDealDate?: string | null;
}

const fmt = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

const fmtSigned = (n: number) =>
  `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "—";

const netClass = (n: number) => {
  if (n > 0) return "net-positive";
  if (n < 0) return "net-negative";
  return "";
};

export const DealHistoryPage: FC = () => {
  const [view, setView] = useState<View>("deals");

  // --- Deal list state ---
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("dateDesc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 25;

  // --- Analytics state ---
  const [analytics, setAnalytics] = useState<LocationAnalytic[]>([]);
  const [totalDeals, setTotalDeals] = useState(0);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get<{ deals: DealSummary[]; total: number }>(
          "/api/deals",
          {
            params: {
              status: "finalized",
              q: q.trim() || undefined,
              sortBy,
              limit: pageSize,
              offset: (page - 1) * pageSize,
            },
          },
        );
        setDeals(res.data.deals ?? []);
        setTotal(res.data.total ?? 0);
      } catch (error) {
        console.error("Failed to fetch deal history:", error);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [q, sortBy, page]);

  useEffect(() => {
    if (view !== "analytics") return;
    const load = async () => {
      setAnalyticsLoading(true);
      try {
        const res = await axios.get<{
          analytics: LocationAnalytic[];
          totalDeals: number;
        }>("/api/deals/analytics");
        setAnalytics(res.data.analytics ?? []);
        setTotalDeals(res.data.totalDeals ?? 0);
      } catch (error) {
        console.error("Failed to fetch analytics:", error);
      } finally {
        setAnalyticsLoading(false);
      }
    };
    void load();
  }, [view]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const grandNetCash = analytics.reduce((s, a) => s + a.totalNetCash, 0);

  return (
    <div className="deal-history-page">
      <h1>Deal History</h1>

      <div className="deal-history-tabs">
        <button
          type="button"
          className={`nav-btn${view === "deals" ? " active" : ""}`}
          onClick={() => setView("deals")}
        >
          All Deals
        </button>
        <button
          type="button"
          className={`nav-btn${view === "analytics" ? " active" : ""}`}
          onClick={() => setView("analytics")}
        >
          Location Analytics
        </button>
      </div>

      {/* ---- DEALS VIEW ---- */}
      {view === "deals" && (
        <>
          <div className="deal-history-controls">
            <input
              type="text"
              className="search-input"
              placeholder="Search by location or notes…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <select
              className="search-sort"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortBy);
                setPage(1);
              }}
            >
              <option value="dateDesc">Newest First</option>
              <option value="dateAsc">Oldest First</option>
              <option value="location">Location A–Z</option>
            </select>
            <span className="deal-history-count">
              {total} deal{total === 1 ? "" : "s"}
            </span>
          </div>

          {loading && <div className="loading">Loading deals…</div>}

          {!loading && deals.length === 0 && (
            <div className="search-status-banner">
              No finalized deals found.
            </div>
          )}

          {!loading && deals.length > 0 && (
            <table className="deal-history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Location</th>
                  <th>In / Out</th>
                  <th>Incoming</th>
                  <th>Outgoing</th>
                  <th>Net Cash</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const isExpanded = expandedId === deal.id;
                  return (
                    <Fragment key={deal.id}>
                      <tr
                        className={`deal-history-row${isExpanded ? " expanded" : ""}`}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : deal.id)
                        }
                      >
                        <td>
                          {fmtDate(deal.dateFinalized ?? deal.dateCreated)}
                        </td>
                        <td>
                          {deal.location ?? (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="text-muted">
                          {deal.incoming.length} / {deal.outgoing.length}
                        </td>
                        <td>{fmt(deal.incomingTotal)}</td>
                        <td>{fmt(deal.outgoingTotal)}</td>
                        <td className={netClass(deal.netCash)}>
                          {fmtSigned(deal.netCash)}
                        </td>
                        <td className="deal-expand-cell">
                          {isExpanded ? "▲" : "▼"}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="deal-detail-row">
                          <td colSpan={7}>
                            <div className="deal-detail-grid">
                              {(["incoming", "outgoing"] as const).map(
                                (dir) => (
                                  <div key={dir} className="deal-detail-col">
                                    <div className="deal-detail-col-header">
                                      {dir === "incoming"
                                        ? "Incoming"
                                        : "Outgoing"}
                                    </div>
                                    {deal[dir].length === 0 && (
                                      <div className="text-muted">No items</div>
                                    )}
                                    {deal[dir].map((item) => (
                                      <div
                                        key={item.id}
                                        className="deal-detail-item"
                                      >
                                        {item.card?.data?.images?.small ? (
                                          <img
                                            src={item.card.data.images.small}
                                            alt={item.card.data.name}
                                            className="deal-detail-thumb"
                                          />
                                        ) : (
                                          <div className="deal-detail-thumb deal-detail-thumb--empty" />
                                        )}
                                        <div className="deal-detail-item-info">
                                          <span className="deal-detail-item-name">
                                            {item.notes ||
                                              item.card?.data?.name ||
                                              item.itemType}
                                            {item.itemType !== "card" && (
                                              <span className="item-type-badge">
                                                {" "}
                                                [{item.itemType}]
                                              </span>
                                            )}
                                          </span>
                                          {(item.card?.data?.number ||
                                            item.card?.data?.set?.name) && (
                                            <span className="deal-detail-item-meta">
                                              {item.card.data.number &&
                                                `#${item.card.data.number}`}
                                              {item.card.data.number &&
                                                item.card.data.set?.name &&
                                                " · "}
                                              {item.card.data.set?.name}
                                            </span>
                                          )}
                                          <span className="deal-detail-item-price">
                                            {item.quantity} × {fmt(item.price)}{" "}
                                            = {fmt(item.quantity * item.price)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ),
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {total > pageSize && (
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
        </>
      )}

      {/* ---- ANALYTICS VIEW ---- */}
      {view === "analytics" && (
        <>
          {analyticsLoading && (
            <div className="loading">Loading analytics…</div>
          )}

          {!analyticsLoading && analytics.length === 0 && (
            <div className="search-status-banner">No finalized deals yet.</div>
          )}

          {!analyticsLoading && analytics.length > 0 && (
            <>
              <div className="analytics-summary">
                <div className="total-item">
                  <span>Total Deals</span>
                  <strong>{totalDeals}</strong>
                </div>
                <div className="total-item">
                  <span>Locations</span>
                  <strong>{analytics.length}</strong>
                </div>
                <div className={`total-item ${netClass(grandNetCash)}`}>
                  <span>Overall Net Cash</span>
                  <strong>{fmtSigned(grandNetCash)}</strong>
                </div>
              </div>

              <table className="deal-history-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Deals</th>
                    <th>Last Deal</th>
                    <th>Total Incoming</th>
                    <th>Total Outgoing</th>
                    <th>Net Cash</th>
                    <th>Avg Net / Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.map((loc) => (
                    <tr key={loc.location} className="deal-history-row">
                      <td>
                        <strong>{loc.location}</strong>
                      </td>
                      <td>{loc.dealCount}</td>
                      <td className="text-muted">
                        {fmtDate(loc.lastDealDate)}
                      </td>
                      <td>{fmt(loc.totalIncoming)}</td>
                      <td>{fmt(loc.totalOutgoing)}</td>
                      <td className={netClass(loc.totalNetCash)}>
                        {fmtSigned(loc.totalNetCash)}
                      </td>
                      <td className={netClass(loc.avgNetCash)}>
                        {fmtSigned(loc.avgNetCash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
};
