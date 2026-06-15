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
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

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
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editItems, setEditItems] = useState<EditableDealItem[]>([]);
  const [incomingPercentage, setIncomingPercentage] = useState("100");
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);
  const [crudError, setCrudError] = useState<string | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealSummary | null>(null);
  const [crudLoading, setCrudLoading] = useState(false);
  const editingDeal =
    editingDealId !== null
      ? (deals.find((deal) => deal.id === editingDealId) ?? null)
      : null;

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
    setExpandedId(deal.id);
    setEditingDealId(deal.id);
    setEditLocation(deal.location || "");
    setEditNotes(deal.notes || "");
    setIncomingPercentage("100");
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

  const handleEditClose = () => {
    setEditingDealId(null);
    setEditItems([]);
    setRemovedItemIds([]);
    setCrudError(null);
    setIncomingPercentage("100");
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

  const addNewEditItem = (direction: "incoming" | "outgoing") => {
    setEditItems((items) => [
      ...items,
      {
        ...createNewEditableItem(),
        direction,
      },
    ]);
  };

  const applyIncomingPercentage = () => {
    const pct = Number.parseFloat(incomingPercentage);
    if (!Number.isFinite(pct) || pct <= 0) {
      setCrudError("Incoming % must be a valid number greater than 0.");
      return;
    }

    const multiplier = pct / 100;
    setCrudError(null);
    setEditItems((items) =>
      items.map((item) => {
        if (item.direction !== "incoming") {
          return item;
        }
        const currentPrice = Number.parseFloat(item.price);
        const safePrice = Number.isFinite(currentPrice) ? currentPrice : 0;
        return {
          ...item,
          price: (safePrice * multiplier).toFixed(2),
        };
      }),
    );
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

      handleEditClose();
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

  const toCsvCell = (value: string | number) => {
    const raw = String(value ?? "");
    if (/[,"\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const formatExportMoney = (n: number) => n.toFixed(2);

  const getDealTimestamp = (deal: DealSummary) =>
    deal.dateFinalized ?? deal.dateCreated;

  const matchesAnalyticsFilters = (deal: DealSummary) => {
    const locationOk = filterLocation
      ? (deal.location || "").toLowerCase() === filterLocation.toLowerCase()
      : true;

    const date = getDealTimestamp(deal);
    const fromOk = filterDateFrom ? date.slice(0, 10) >= filterDateFrom : true;
    const toOk = filterDateTo ? date.slice(0, 10) <= filterDateTo : true;

    return locationOk && fromOk && toOk;
  };

  const applyDealsViewSort = (items: DealSummary[]) => {
    const next = [...items];
    if (sortBy === "location") {
      next.sort((a, b) =>
        (a.location || "").localeCompare(b.location || "", undefined, {
          sensitivity: "base",
        }),
      );
      return next;
    }

    next.sort((a, b) => {
      const aDate = new Date(getDealTimestamp(a)).getTime();
      const bDate = new Date(getDealTimestamp(b)).getTime();
      return sortBy === "dateAsc" ? aDate - bDate : bDate - aDate;
    });
    return next;
  };

  const buildExportCsv = (items: DealSummary[]) => {
    const rows: string[][] = [
      ["Export Type", "Deal History"],
      ["Exported At", new Date().toLocaleString()],
      ["View", view],
      ["Total Deals", String(items.length)],
      [],
      [
        "Deal ID",
        "Date",
        "Location",
        "Incoming Total",
        "Outgoing Total",
        "Net Cash",
        "Incoming Item Count",
        "Outgoing Item Count",
        "Notes",
      ],
    ];

    items.forEach((deal) => {
      rows.push([
        deal.id,
        getDealTimestamp(deal),
        deal.location || "",
        formatExportMoney(deal.incomingTotal),
        formatExportMoney(deal.outgoingTotal),
        formatExportMoney(deal.netCash),
        String(deal.incoming.length),
        String(deal.outgoing.length),
        deal.notes || "",
      ]);
    });

    rows.push([]);
    rows.push([
      "Deal ID",
      "Direction",
      "Item Type",
      "Name",
      "Set",
      "Number",
      "Quantity",
      "Unit Price",
      "Line Total",
      "Notes",
    ]);

    items.forEach((deal) => {
      (["incoming", "outgoing"] as const).forEach((direction) => {
        deal[direction].forEach((item) => {
          const itemName = item.notes || item.card?.data?.name || item.itemType;
          const lineTotal = item.price * item.quantity;
          rows.push([
            deal.id,
            direction,
            item.itemType,
            itemName,
            item.card?.data?.set?.name || "",
            item.card?.data?.number || "",
            String(item.quantity),
            formatExportMoney(item.price),
            formatExportMoney(lineTotal),
            item.notes || "",
          ]);
        });
      });
    });

    return rows
      .map((r) => r.map((cell) => toCsvCell(cell)).join(","))
      .join("\n");
  };

  const exportFilteredDeals = async () => {
    setIsExporting(true);
    setExportNotice(null);
    try {
      const limit = 250;
      let offset = 0;
      let hasMore = true;
      const allDeals: DealSummary[] = [];

      while (hasMore) {
        const res = await axios.get<{ deals: DealSummary[]; total: number }>(
          "/api/deals",
          {
            params: {
              status: "finalized",
              limit,
              offset,
            },
          },
        );

        const batch = res.data.deals ?? [];
        allDeals.push(...batch);
        offset += batch.length;
        hasMore = batch.length === limit;
      }

      let exportDeals = allDeals;

      if (view === "deals") {
        const qLower = q.trim().toLowerCase();
        if (qLower) {
          exportDeals = exportDeals.filter((deal) =>
            `${deal.location || ""} ${deal.notes || ""}`
              .toLowerCase()
              .includes(qLower),
          );
        }
        exportDeals = applyDealsViewSort(exportDeals);
      } else {
        exportDeals = exportDeals
          .filter((deal) => matchesAnalyticsFilters(deal))
          .sort(
            (a, b) =>
              new Date(getDealTimestamp(b)).getTime() -
              new Date(getDealTimestamp(a)).getTime(),
          );
      }

      if (exportDeals.length === 0) {
        setExportNotice("No deals matched the current filters to export.");
        return;
      }

      const csv = `\uFEFF${buildExportCsv(exportDeals)}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const datePart = new Date().toISOString().slice(0, 10);

      link.href = url;
      link.download = `deal-history-${view}-${datePart}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportNotice(
        `Exported ${exportDeals.length} finalized deal${exportDeals.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      console.error("Failed to export deal history:", error);
      setExportNotice("Failed to export deal history.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="deal-history-page">
      <h1>Deal History</h1>

      {exportNotice && (
        <div className="search-status-banner">{exportNotice}</div>
      )}

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
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void exportFilteredDeals()}
              disabled={isExporting}
            >
              {isExporting ? "Exporting…" : "Export to Spreadsheet"}
            </button>
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
                  const isEditing = editingDealId === deal.id;
                  return (
                    <Fragment key={deal.id}>
                      <tr
                        className={`deal-history-row${isExpanded ? " expanded" : ""}${isEditing ? " editing" : ""}`}
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
                              if (editingDealId === deal.id) {
                                handleEditClose();
                                return;
                              }
                              handleEditOpen(deal);
                            }}
                          >
                            {isEditing ? "Cancel Edit" : "Edit"}
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
                        <tr
                          className={`deal-detail-row${isEditing ? " editing" : ""}`}
                        >
                          <td colSpan={7}>
                            {isEditing ? (
                              <div className="deal-edit-expanded is-editing">
                                <div className="deal-edit-header">
                                  <div className="form-group">
                                    <label htmlFor={`loc-${deal.id}`}>
                                      Location
                                    </label>
                                    <select
                                      id={`loc-${deal.id}`}
                                      value={editLocation}
                                      onChange={(e) =>
                                        setEditLocation(e.target.value)
                                      }
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
                                    <label htmlFor={`notes-${deal.id}`}>
                                      Notes
                                    </label>
                                    <textarea
                                      id={`notes-${deal.id}`}
                                      value={editNotes}
                                      onChange={(e) =>
                                        setEditNotes(e.target.value)
                                      }
                                      placeholder="Optional notes about this deal…"
                                      rows={2}
                                    />
                                  </div>
                                </div>

                                <div className="deal-edit-items-section">
                                  {(["incoming", "outgoing"] as const).map(
                                    (dir) => {
                                      const dirItems = editItems.filter(
                                        (i) => i.direction === dir,
                                      );
                                      return (
                                        <div
                                          key={dir}
                                          className="deal-edit-item-box"
                                        >
                                          <div className="deal-edit-item-box-header">
                                            <span>
                                              {dir === "incoming"
                                                ? "Incoming"
                                                : "Outgoing"}
                                            </span>
                                            <button
                                              type="button"
                                              className="modal-btn modal-btn-secondary"
                                              onClick={() =>
                                                addNewEditItem(dir)
                                              }
                                              disabled={crudLoading}
                                            >
                                              + Add Item
                                            </button>
                                          </div>
                                          {dir === "incoming" && (
                                            <div className="incoming-percentage-controls">
                                              <input
                                                type="number"
                                                min="1"
                                                step="0.1"
                                                value={incomingPercentage}
                                                onChange={(e) =>
                                                  setIncomingPercentage(
                                                    e.target.value,
                                                  )
                                                }
                                                placeholder="Percentage"
                                                aria-label="Incoming item percentage"
                                              />
                                              <button
                                                type="button"
                                                className="modal-btn modal-btn-secondary"
                                                onClick={
                                                  applyIncomingPercentage
                                                }
                                                disabled={crudLoading}
                                              >
                                                Apply %
                                              </button>
                                            </div>
                                          )}
                                          {dirItems.length === 0 ? (
                                            <div className="text-muted">
                                              No items
                                            </div>
                                          ) : (
                                            <div className="edit-item-list">
                                              {dirItems.map((item) => {
                                                const itemTypeOptions =
                                                  Array.from(
                                                    new Set([
                                                      ...DEFAULT_ITEM_TYPES,
                                                      item.itemType || "card",
                                                    ]),
                                                  );
                                                return (
                                                  <div
                                                    key={item.id}
                                                    className="edit-item-inline"
                                                  >
                                                    <input
                                                      type="text"
                                                      value={item.notes}
                                                      onChange={(e) =>
                                                        updateEditItem(
                                                          item.id,
                                                          "notes",
                                                          e.target.value,
                                                        )
                                                      }
                                                      placeholder={item.label}
                                                      className="edit-item-name"
                                                    />
                                                    <select
                                                      value={item.itemType}
                                                      onChange={(e) =>
                                                        updateEditItem(
                                                          item.id,
                                                          "itemType",
                                                          e.target.value,
                                                        )
                                                      }
                                                    >
                                                      {itemTypeOptions.map(
                                                        (type) => (
                                                          <option
                                                            key={type}
                                                            value={type}
                                                          >
                                                            {type}
                                                          </option>
                                                        ),
                                                      )}
                                                    </select>
                                                    <input
                                                      type="number"
                                                      min="1"
                                                      step="1"
                                                      value={item.quantity}
                                                      onChange={(e) =>
                                                        updateEditItem(
                                                          item.id,
                                                          "quantity",
                                                          e.target.value,
                                                        )
                                                      }
                                                      placeholder="Qty"
                                                    />
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      step="0.01"
                                                      value={item.price}
                                                      onChange={(e) =>
                                                        updateEditItem(
                                                          item.id,
                                                          "price",
                                                          e.target.value,
                                                        )
                                                      }
                                                      placeholder="Price"
                                                    />
                                                    <button
                                                      type="button"
                                                      className="action-btn action-btn-delete"
                                                      onClick={() =>
                                                        removeEditItem(item.id)
                                                      }
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    },
                                  )}
                                </div>

                                {crudError && (
                                  <p className="text-warning">{crudError}</p>
                                )}

                                <div className="deal-edit-footer">
                                  <button
                                    type="button"
                                    className="modal-btn modal-btn-cancel"
                                    onClick={handleEditClose}
                                    disabled={crudLoading}
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
                            ) : (
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
                                        <div className="text-muted">
                                          No items
                                        </div>
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
                                              {item.quantity} ×{" "}
                                              {fmt(item.price)} ={" "}
                                              {fmt(item.quantity * item.price)}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
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
