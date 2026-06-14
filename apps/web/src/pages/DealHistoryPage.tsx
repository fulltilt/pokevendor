import { useEffect, useState, Fragment } from "react";
import type { FC } from "react";
import axios from "axios";

type SortBy = "dateDesc" | "dateAsc" | "location";
type View = "deals" | "showAnalytics" | "timeAnalytics";
type GroupBy = "month" | "year";

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

interface EditableDealItem {
  id: string;
  direction: "incoming" | "outgoing";
  quantity: string;
  price: string;
  itemType: string;
  notes: string;
  label: string;
  isNew?: boolean;
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

interface TimeAnalytic {
  period: string;
  year: number;
  month?: number;
  dealCount: number;
  totalIncoming: number;
  totalOutgoing: number;
  totalNetCash: number;
  avgNetCash: number;
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

const DEFAULT_ITEM_TYPES = ["card", "sealed", "slab", "cash"];

const createNewEditableItem = (): EditableDealItem => ({
  id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  direction: "incoming",
  quantity: "1",
  price: "0",
  itemType: "card",
  notes: "",
  label: "Manual item",
  isNew: true,
});

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
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const pageSize = 25;

  // --- Analytics filter state ---
  const [filterLocation, setFilterLocation] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("month");

  // --- Location Analytics state ---
  const [showAnalytics, setShowAnalytics] = useState<LocationAnalytic[]>([]);
  const [showAnalyticsTotal, setShowAnalyticsTotal] = useState(0);
  const [showAnalyticsLoading, setShowAnalyticsLoading] = useState(false);

  // --- Time Analytics state ---
  const [timeAnalytics, setTimeAnalytics] = useState<TimeAnalytic[]>([]);
  const [timeAnalyticsTotal, setTimeAnalyticsTotal] = useState(0);
  const [timeAnalyticsLoading, setTimeAnalyticsLoading] = useState(false);

  // --- CRUD modals state ---
  const [editingDeal, setEditingDeal] = useState<DealSummary | null>(null);
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editItems, setEditItems] = useState<EditableDealItem[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);
  const [crudError, setCrudError] = useState<string | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealSummary | null>(null);
  const [crudLoading, setCrudLoading] = useState(false);

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

        // Extract all unique locations for filter dropdown
        if (page === 1) {
          const allDealsRes = await axios.get<{
            deals: DealSummary[];
            total: number;
          }>("/api/deals", {
            params: {
              status: "finalized",
              limit: 1000,
            },
          });
          const uniqueLocs = Array.from(
            new Set(
              allDealsRes.data.deals
                .map((d) => d.location)
                .filter((loc): loc is string => Boolean(loc?.trim())),
            ),
          ).sort((a, b) => a.localeCompare(b));
          setAllLocations(uniqueLocs);
        }
      } catch (error) {
        console.error("Failed to fetch deal history:", error);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [q, sortBy, page]);

  // --- Fetch Show (Location) Analytics ---
  useEffect(() => {
    if (view !== "showAnalytics") return;
    const load = async () => {
      setShowAnalyticsLoading(true);
      try {
        const res = await axios.get<{
          analytics: LocationAnalytic[];
          totalDeals: number;
        }>("/api/deals/analytics", {
          params: {
            ...(filterLocation && { location: filterLocation }),
            ...(filterDateFrom && { dateFrom: filterDateFrom }),
            ...(filterDateTo && { dateTo: filterDateTo }),
          },
        });
        setShowAnalytics(res.data.analytics ?? []);
        setShowAnalyticsTotal(res.data.totalDeals ?? 0);
      } catch (error) {
        console.error("Failed to fetch show analytics:", error);
      } finally {
        setShowAnalyticsLoading(false);
      }
    };
    void load();
  }, [view, filterLocation, filterDateFrom, filterDateTo]);

  // --- Fetch Time Analytics ---
  useEffect(() => {
    if (view !== "timeAnalytics") return;
    const load = async () => {
      setTimeAnalyticsLoading(true);
      try {
        const res = await axios.get<{
          analytics: TimeAnalytic[];
          totalDeals: number;
        }>("/api/deals/analytics/time", {
          params: {
            groupBy,
            ...(filterLocation && { location: filterLocation }),
            ...(filterDateFrom && { dateFrom: filterDateFrom }),
            ...(filterDateTo && { dateTo: filterDateTo }),
          },
        });
        setTimeAnalytics(res.data.analytics ?? []);
        setTimeAnalyticsTotal(res.data.totalDeals ?? 0);
      } catch (error) {
        console.error("Failed to fetch time analytics:", error);
      } finally {
        setTimeAnalyticsLoading(false);
      }
    };
    void load();
  }, [view, groupBy, filterLocation, filterDateFrom, filterDateTo]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const grandShowNetCash = showAnalytics.reduce(
    (s, a) => s + a.totalNetCash,
    0,
  );
  const grandTimeNetCash = timeAnalytics.reduce(
    (s, a) => s + a.totalNetCash,
    0,
  );

  // --- CRUD Handlers ---
  const handleEditOpen = (deal: DealSummary) => {
    setEditingDeal(deal);
    setEditLocation(deal.location || "");
    setEditNotes(deal.notes || "");
    setRemovedItemIds([]);
    setCrudError(null);
    setEditItems(
      [...deal.incoming, ...deal.outgoing].map((item) => ({
        id: item.id,
        direction: item.direction === "outgoing" ? "outgoing" : "incoming",
        quantity: String(item.quantity),
        price: String(item.price),
        itemType: item.itemType || "card",
        notes: item.notes || "",
        label: item.card?.data?.name || item.itemType || "Deal item",
      })),
    );
  };

  const updateEditItem = (
    itemId: string,
    field: keyof Omit<EditableDealItem, "id" | "label">,
    value: string,
  ) => {
    setEditItems((items) =>
      items.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item,
      ),
    );
  };

  const removeEditItem = (itemId: string) => {
    setEditItems((items) => {
      const target = items.find((item) => item.id === itemId);
      if (!target) {
        return items;
      }
      if (!target.isNew) {
        setRemovedItemIds((ids) =>
          ids.includes(itemId) ? ids : [...ids, itemId],
        );
      }
      return items.filter((item) => item.id !== itemId);
    });
  };

  const addNewEditItem = () => {
    setEditItems((items) => [...items, createNewEditableItem()]);
  };

  const handleEditSave = async () => {
    if (!editingDeal) return;
    setCrudError(null);

    const parsedItems = editItems.map((item) => {
      const quantity = Number.parseInt(item.quantity, 10);
      const price = Number.parseFloat(item.price);
      return {
        ...item,
        quantity,
        price,
        notes: item.notes.trim() || null,
        itemType: item.itemType.trim() || "card",
      };
    });

    if (
      parsedItems.some(
        (item) => !Number.isFinite(item.quantity) || item.quantity <= 0,
      )
    ) {
      setCrudError("All item quantities must be whole numbers greater than 0.");
      return;
    }

    if (
      parsedItems.some((item) => !Number.isFinite(item.price) || item.price < 0)
    ) {
      setCrudError(
        "All item prices must be valid numbers greater than or equal to 0.",
      );
      return;
    }

    setCrudLoading(true);
    try {
      const updates: Promise<unknown>[] = [
        axios.patch(`/api/deals/${editingDeal.id}`, {
          location: editLocation.trim() || null,
          notes: editNotes.trim() || null,
        }),
      ];

      for (const item of parsedItems) {
        if (item.isNew) {
          updates.push(
            axios.post(`/api/deals/${editingDeal.id}/items`, {
              direction: item.direction,
              quantity: item.quantity,
              price: item.price,
              itemType: item.itemType,
              notes: item.notes,
            }),
          );
        } else {
          updates.push(
            axios.patch(`/api/deals/items/${item.id}`, {
              direction: item.direction,
              quantity: item.quantity,
              price: item.price,
              itemType: item.itemType,
              notes: item.notes,
            }),
          );
        }
      }

      for (const itemId of removedItemIds) {
        updates.push(axios.delete(`/api/deals/items/${itemId}`));
      }

      await Promise.all(updates);

      setEditingDeal(null);
      setEditItems([]);
      setRemovedItemIds([]);
      // Reload deals
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
      console.error("Failed to update deal:", error);
      setCrudError("Failed to save changes. Please try again.");
    } finally {
      setCrudLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingDeal) return;
    setCrudLoading(true);
    try {
      await axios.delete(`/api/deals/${deletingDeal.id}`);
      setDeletingDeal(null);
      // Reload deals
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
      console.error("Failed to delete deal:", error);
    } finally {
      setCrudLoading(false);
    }
  };

  const editLocationOptions = Array.from(
    new Set(
      [
        ...allLocations,
        editLocation.trim(),
        editingDeal?.location?.trim() ?? "",
      ].filter((loc) => loc.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

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
          className={`nav-btn${view === "showAnalytics" ? " active" : ""}`}
          onClick={() => setView("showAnalytics")}
        >
          Show Analytics
        </button>
        <button
          type="button"
          className={`nav-btn${view === "timeAnalytics" ? " active" : ""}`}
          onClick={() => setView("timeAnalytics")}
        >
          Time Analytics
        </button>
      </div>

      {/* ---- ANALYTICS FILTERS (shown on analytics views) ---- */}
      {(view === "showAnalytics" || view === "timeAnalytics") && (
        <div className="analytics-filter-controls">
          <select
            className="filter-select"
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
          >
            <option value="">All Shows</option>
            {allLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="filter-date"
            placeholder="From"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="filter-date"
            placeholder="To"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
          />

          {(filterLocation || filterDateFrom || filterDateTo) && (
            <button
              type="button"
              className="filter-reset-btn"
              onClick={() => {
                setFilterLocation("");
                setFilterDateFrom("");
                setFilterDateTo("");
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const isExpanded = expandedId === deal.id;
                  return (
                    <Fragment key={deal.id}>
                      <tr
                        className={`deal-history-row${isExpanded ? " expanded" : ""}`}
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
                        <td className="deal-actions-cell">
                          <button
                            type="button"
                            className="action-btn action-btn-edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditOpen(deal);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="action-btn action-btn-delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingDeal(deal);
                            }}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="deal-expand-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : deal.id);
                            }}
                          >
                            {isExpanded ? "▲" : "▼"}
                          </button>
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

      {/* ---- SHOW ANALYTICS VIEW ---- */}
      {view === "showAnalytics" && (
        <>
          {showAnalyticsLoading && (
            <div className="loading">Loading show analytics…</div>
          )}

          {!showAnalyticsLoading && showAnalytics.length === 0 && (
            <div className="search-status-banner">
              No finalized deals found.
            </div>
          )}

          {!showAnalyticsLoading && showAnalytics.length > 0 && (
            <>
              <div className="analytics-summary">
                <div className="total-item">
                  <span>Total Deals</span>
                  <strong>{showAnalyticsTotal}</strong>
                </div>
                <div className="total-item">
                  <span>Shows</span>
                  <strong>{showAnalytics.length}</strong>
                </div>
                <div className={`total-item ${netClass(grandShowNetCash)}`}>
                  <span>Overall Net Cash</span>
                  <strong>{fmtSigned(grandShowNetCash)}</strong>
                </div>
              </div>

              <table className="deal-history-table">
                <thead>
                  <tr>
                    <th>Show / Location</th>
                    <th>Deals</th>
                    <th>Last Deal</th>
                    <th>Total Incoming</th>
                    <th>Total Outgoing</th>
                    <th>Net Cash</th>
                    <th>Avg Net / Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {showAnalytics.map((loc) => (
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

      {/* ---- TIME ANALYTICS VIEW ---- */}
      {view === "timeAnalytics" && (
        <>
          {timeAnalyticsLoading && (
            <div className="loading">Loading time analytics…</div>
          )}

          {!timeAnalyticsLoading && timeAnalytics.length === 0 && (
            <div className="search-status-banner">
              No finalized deals found.
            </div>
          )}

          {!timeAnalyticsLoading && timeAnalytics.length > 0 && (
            <>
              <div className="analytics-summary">
                <div className="total-item">
                  <span>Total Deals</span>
                  <strong>{timeAnalyticsTotal}</strong>
                </div>
                <div className="total-item">
                  <span>Periods</span>
                  <strong>{timeAnalytics.length}</strong>
                </div>
                <div className={`total-item ${netClass(grandTimeNetCash)}`}>
                  <span>Overall Net Cash</span>
                  <strong>{fmtSigned(grandTimeNetCash)}</strong>
                </div>
              </div>

              <div className="time-analytics-controls">
                <label>
                  <input
                    type="radio"
                    value="month"
                    checked={groupBy === "month"}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  />
                  By Month
                </label>
                <label>
                  <input
                    type="radio"
                    value="year"
                    checked={groupBy === "year"}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  />
                  By Year
                </label>
              </div>

              <table className="deal-history-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Deals</th>
                    <th>Total Incoming</th>
                    <th>Total Outgoing</th>
                    <th>Net Cash</th>
                    <th>Avg Net / Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {timeAnalytics.map((entry) => (
                    <tr key={entry.period} className="deal-history-row">
                      <td>
                        <strong>{entry.period}</strong>
                      </td>
                      <td>{entry.dealCount}</td>
                      <td>{fmt(entry.totalIncoming)}</td>
                      <td>{fmt(entry.totalOutgoing)}</td>
                      <td className={netClass(entry.totalNetCash)}>
                        {fmtSigned(entry.totalNetCash)}
                      </td>
                      <td className={netClass(entry.avgNetCash)}>
                        {fmtSigned(entry.avgNetCash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {/* --- EDIT DEAL MODAL --- */}
      {editingDeal && (
        <div className="modal-overlay" onClick={() => setEditingDeal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Deal</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditingDeal(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="edit-deal-location">Location</label>
                <select
                  id="edit-deal-location"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                >
                  <option value="">No location</option>
                  {editLocationOptions.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="edit-deal-notes">Notes</label>
                <textarea
                  id="edit-deal-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional notes about this deal…"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <div className="deal-edit-items-label">Items</div>
                <div className="edit-item-toolbar">
                  <button
                    type="button"
                    className="modal-btn modal-btn-primary"
                    onClick={addNewEditItem}
                    disabled={crudLoading}
                  >
                    Add Item
                  </button>
                </div>
                {editItems.length === 0 && (
                  <div className="text-muted">No items in this deal.</div>
                )}
                <div className="edit-item-list">
                  {editItems.map((item) => {
                    const itemTypeOptions = Array.from(
                      new Set([...DEFAULT_ITEM_TYPES, item.itemType || "card"]),
                    );
                    return (
                      <div key={item.id} className="edit-item-row">
                        <div className="edit-item-label" title={item.label}>
                          {item.isNew ? "New item" : item.label}
                        </div>
                        <select
                          value={item.direction}
                          onChange={(e) =>
                            updateEditItem(item.id, "direction", e.target.value)
                          }
                        >
                          <option value="incoming">Incoming</option>
                          <option value="outgoing">Outgoing</option>
                        </select>
                        <select
                          value={item.itemType}
                          onChange={(e) =>
                            updateEditItem(item.id, "itemType", e.target.value)
                          }
                        >
                          {itemTypeOptions.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(e) =>
                            updateEditItem(item.id, "quantity", e.target.value)
                          }
                          aria-label={`Quantity for ${item.label}`}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.price}
                          onChange={(e) =>
                            updateEditItem(item.id, "price", e.target.value)
                          }
                          aria-label={`Price for ${item.label}`}
                        />
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) =>
                            updateEditItem(item.id, "notes", e.target.value)
                          }
                          placeholder={
                            item.isNew ? "Item name or notes" : "Item notes"
                          }
                          aria-label={`Notes for ${item.label}`}
                        />
                        <button
                          type="button"
                          className="action-btn action-btn-delete"
                          onClick={() => removeEditItem(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {crudError && <p className="text-warning">{crudError}</p>}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-btn modal-btn-cancel"
                onClick={() => setEditingDeal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-primary"
                onClick={handleEditSave}
                disabled={crudLoading}
              >
                {crudLoading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- DELETE CONFIRMATION MODAL --- */}
      {deletingDeal && (
        <div className="modal-overlay" onClick={() => setDeletingDeal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete Deal</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDeletingDeal(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this deal?</p>
              <div className="deal-summary-box">
                <p>
                  <strong>
                    {fmtDate(
                      deletingDeal.dateFinalized ?? deletingDeal.dateCreated,
                    )}
                  </strong>
                  {deletingDeal.location && (
                    <>
                      {" at "}
                      <strong>{deletingDeal.location}</strong>
                    </>
                  )}
                </p>
                <p>
                  Incoming: {fmt(deletingDeal.incomingTotal)} | Outgoing:{" "}
                  {fmt(deletingDeal.outgoingTotal)} | Net:{" "}
                  <span className={netClass(deletingDeal.netCash)}>
                    {fmtSigned(deletingDeal.netCash)}
                  </span>
                </p>
              </div>
              <p className="text-warning">
                This action cannot be undone. All items in this deal will be
                permanently deleted.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-btn modal-btn-cancel"
                onClick={() => setDeletingDeal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-danger"
                onClick={handleDeleteConfirm}
                disabled={crudLoading}
              >
                {crudLoading ? "Deleting…" : "Delete Deal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
