import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";
import axios from "axios";
import {
  CardSearchPanel,
  type SearchCard,
} from "../components/CardSearchPanel";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

type InventoryType = "card" | "sealed" | "slab";
type CardCondition = "NM" | "LP" | "MP" | "HP";

const CONDITION_OPTIONS: CardCondition[] = ["NM", "LP", "MP", "HP"];

const normalizeCardCondition = (
  value: string | null | undefined,
): CardCondition => {
  if (!value) return "NM";
  const upper = value.toUpperCase();
  return CONDITION_OPTIONS.includes(upper as CardCondition)
    ? (upper as CardCondition)
    : "NM";
};

const pickPriceByCondition = (
  prices: { nm: number | null; lp: number | null; mp: number | null } | null,
  condition: CardCondition,
): number | null => {
  if (!prices) return null;
  if (condition === "NM") return prices.nm ?? prices.lp ?? prices.mp;
  if (condition === "LP") return prices.lp ?? prices.nm ?? prices.mp;
  if (condition === "MP") return prices.mp ?? prices.lp ?? prices.nm;
  // HP has no dedicated bucket from TCG, so use MP/LP/NM fallback.
  return prices.mp ?? prices.lp ?? prices.nm;
};

interface InventoryItem {
  id: string;
  cardId: string;
  quantity: number;
  type?: InventoryType;
  condition?: string | null;
  storageType: string;
  pricePurchasedAt: number | string | null;
  priceCurrentAsk?: number | string | null;
  card?: SearchCard;
  notes?: string | null;
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

interface EditingItem extends InventoryItem {
  purchasedAt?: string;
  purchasedFrom?: string;
}

interface PriceChangeSnapshot {
  delta: number;
  percent: number | null;
}

interface RefreshCsvRow {
  name: string;
  cardId: string;
  condition: string;
  previousPrice: number;
  newPrice: number;
  delta: number;
  percent: number | null;
}

type ConditionPriceMap = {
  nm: number | null;
  lp: number | null;
  mp: number | null;
};

const toCsvField = (value: string): string => {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
};

const buildPriceChangeCsv = (rows: RefreshCsvRow[]): string => {
  const header = [
    "Card",
    "Card ID",
    "Condition",
    "Previous Price",
    "New Price",
    "Change",
    "Percent Change",
  ];

  const body = rows.map((row) => [
    toCsvField(row.name),
    toCsvField(row.cardId),
    toCsvField(row.condition),
    row.previousPrice.toFixed(2),
    row.newPrice.toFixed(2),
    row.delta.toFixed(2),
    row.percent == null ? "N/A" : `${row.percent.toFixed(2)}%`,
  ]);

  return [header.join(","), ...body.map((line) => line.join(","))].join("\n");
};

const downloadCsv = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const plural = (count: number, singular: string, pluralWord: string): string =>
  count === 1 ? singular : pluralWord;

const formatPriceChange = (change: PriceChangeSnapshot): string => {
  const deltaSign = change.delta >= 0 ? "+" : "";
  const deltaText = `${deltaSign}$${change.delta.toFixed(2)}`;
  let percentText = "N/A";
  if (change.percent !== null) {
    const percentSign = change.percent >= 0 ? "+" : "";
    percentText = `${percentSign}${change.percent.toFixed(2)}%`;
  }
  return `${deltaText} (${percentText})`;
};

const fetchPricesForCardIds = async (
  cardIds: string[],
): Promise<Record<string, ConditionPriceMap | null>> => {
  const pricesByCardId: Record<string, ConditionPriceMap | null> = {};

  for (const cardId of cardIds) {
    try {
      const priceRes = await axios.get<{
        prices: ConditionPriceMap | null;
      }>(`/api/cards/${cardId}/prices`);
      pricesByCardId[cardId] = priceRes.data.prices ?? null;
    } catch (error) {
      console.error(`Failed to fetch price for card ${cardId}:`, error);
      pricesByCardId[cardId] = null;
    }
  }

  return pricesByCardId;
};

const refreshCardItems = async (
  cardItems: InventoryItem[],
  pricesByCardId: Record<string, ConditionPriceMap | null>,
): Promise<{
  updatedCount: number;
  latestChangesById: Record<string, PriceChangeSnapshot>;
  csvRows: RefreshCsvRow[];
}> => {
  const latestChangesById: Record<string, PriceChangeSnapshot> = {};
  const csvRows: RefreshCsvRow[] = [];
  let updatedCount = 0;

  for (const item of cardItems) {
    const prices = pricesByCardId[item.cardId];
    if (!prices) {
      continue;
    }

    const normalizedCondition = normalizeCardCondition(item.condition);
    const newPrice = pickPriceByCondition(prices, normalizedCondition);
    if (newPrice === null) {
      continue;
    }

    const previousPrice = toFiniteNumber(item.priceCurrentAsk, 0);
    const delta = newPrice - previousPrice;
    const percent = previousPrice > 0 ? (delta / previousPrice) * 100 : null;

    try {
      await axios.patch(`/api/inventory/${item.id}`, {
        priceCurrentAsk: newPrice,
      });
      updatedCount += 1;
      latestChangesById[item.id] = { delta, percent };

      if (Math.abs(delta) >= 3) {
        csvRows.push({
          name: item.notes || item.card?.data?.name || item.cardId,
          cardId: item.cardId,
          condition: normalizedCondition,
          previousPrice,
          newPrice,
          delta,
          percent,
        });
      }
    } catch (error) {
      console.error(`Failed to update price for item ${item.id}:`, error);
    }
  }

  return { updatedCount, latestChangesById, csvRows };
};

export const InventoryPage: FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filterStorageType, setFilterStorageType] = useState<
    "in_case" | "not_in_case" | "all"
  >("all");
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [addQuantity, setAddQuantity] = useState("1");
  const [addStorageType, setAddStorageType] = useState<
    "in_case" | "not_in_case"
  >("in_case");
  const [addItemType, setAddItemType] = useState<InventoryType>("card");
  const [addCondition, setAddCondition] = useState<CardCondition>("NM");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [currentAsk, setCurrentAsk] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [purchaseSource, setPurchaseSource] = useState("");
  const [inventoryNotice, setInventoryNotice] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [editQuantity, setEditQuantity] = useState("1");
  const [editStorageType, setEditStorageType] = useState<
    "in_case" | "not_in_case"
  >("in_case");
  const [editItemType, setEditItemType] = useState<InventoryType>("card");
  const [editCondition, setEditCondition] = useState<CardCondition>("NM");
  const [editPurchasePrice, setEditPurchasePrice] = useState("");
  const [editCurrentAsk, setEditCurrentAsk] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [exportingSinceCsv, setExportingSinceCsv] = useState(false);
  const [manualItemName, setManualItemName] = useState("");
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [editManualItemName, setEditManualItemName] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [inventorySearch, setInventorySearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;
  type InventorySortBy = "condition" | "priceCurrentAsk" | "totalValue" | null;
  const [sortBy, setSortBy] = useState<InventorySortBy>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [priceChangeByItemId, setPriceChangeByItemId] = useState<
    Record<string, PriceChangeSnapshot>
  >({});
  const [priceMovesSinceDate, setPriceMovesSinceDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });

  const handleSort = (col: NonNullable<InventorySortBy>) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(1);
  };

  const sortArrow = (col: NonNullable<InventorySortBy>) => {
    if (sortBy !== col) return " ⇅";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  let manualItemPlaceholder = "e.g., Charizard Base Set";
  if (addItemType === "sealed") {
    manualItemPlaceholder = "e.g., Pokemon Scarlet/Violet Booster Box";
  } else if (addItemType === "slab") {
    manualItemPlaceholder = "e.g., Charizard PSA 9";
  }

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddQuantity("1");
    setAddItemType("card");
    setAddCondition("NM");
    setPurchasePrice("");
    setCurrentAsk("");
    setPurchaseSource("");
    setManualItemName("");
  };

  const buildInventoryQueryParams = useCallback(
    (
      customPage: number,
      customLimit = pageSize,
    ): Record<string, string | number> => {
      const params: Record<string, string | number> =
        filterStorageType === "all" ? {} : { storageType: filterStorageType };
      params.limit = customLimit;
      params.offset = (customPage - 1) * customLimit;
      if (inventorySearch.trim()) {
        params.q = inventorySearch.trim();
      }
      if (sortBy) {
        params.sortBy = sortBy;
        params.sortDir = sortDir;
      }
      return params;
    },
    [filterStorageType, inventorySearch, sortBy, sortDir],
  );

  useEffect(() => {
    const loadInventory = async () => {
      setLoading(true);
      try {
        const params = buildInventoryQueryParams(page);
        const response = await axios.get("/api/inventory", { params });
        setItems(response.data.items);
        setTotalValue(response.data.totalValue);
        setTotalCount(response.data.total ?? 0);
      } catch (error) {
        console.error("Failed to fetch inventory:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadInventory();
  }, [buildInventoryQueryParams, page]);

  const reloadInventory = async () => {
    const params = buildInventoryQueryParams(page);
    const response = await axios.get("/api/inventory", { params });
    setItems(response.data.items);
    setTotalValue(response.data.totalValue);
    setTotalCount(response.data.total ?? 0);
  };

  const removeInventoryItem = async (itemId: string) => {
    try {
      await axios.delete(`/api/inventory/${itemId}`);
      await reloadInventory();
    } catch (error) {
      console.error("Failed to remove inventory item:", error);
    }
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setEditQuantity(String(item.quantity));
    setEditStorageType(item.storageType as "in_case" | "not_in_case");
    setEditItemType(item.type ?? "card");
    setEditCondition(normalizeCardCondition(item.condition));
    setEditPurchasePrice(String(toFiniteNumber(item.pricePurchasedAt)));
    const hasCurrentAskValue =
      item.priceCurrentAsk !== null && item.priceCurrentAsk !== undefined;
    const nextCurrentAsk = hasCurrentAskValue
      ? toFiniteNumber(item.priceCurrentAsk)
      : toFiniteNumber(item.pricePurchasedAt);
    setEditCurrentAsk(String(nextCurrentAsk));
    setEditManualItemName(item.notes || "");
  };

  const closeEditModal = () => {
    setEditingItem(null);
  };

  const saveEdits = async () => {
    if (!editingItem) return;

    setEditSaving(true);
    try {
      await axios.patch(`/api/inventory/${editingItem.id}`, {
        quantity: Number.parseInt(editQuantity) || 1,
        type: editItemType,
        storageType: editStorageType,
        condition: editCondition,
        pricePurchasedAt: Number.parseFloat(editPurchasePrice) || 0,
        priceCurrentAsk: Number.parseFloat(editCurrentAsk) || 0,
        notes: editManualItemName || undefined,
      });

      await reloadInventory();
      setInventoryNotice("Inventory item updated successfully.");
      closeEditModal();
    } catch (error) {
      console.error("Failed to save inventory item:", error);
      setInventoryNotice("Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const refreshAllPrices = async () => {
    setRefreshingPrices(true);
    setInventoryNotice(null);

    try {
      const allItemsResponse = await axios.get<{
        items: InventoryItem[];
        total: number;
      }>("/api/inventory", {
        params: buildInventoryQueryParams(1, 2000),
      });
      const allVisibleItems = allItemsResponse.data.items ?? [];

      if (!allVisibleItems.length) {
        setInventoryNotice("No items to refresh.");
        return;
      }

      // Only refresh card-type items; skip sealed/slab
      const cardItems = allVisibleItems.filter(
        (item) => (item.type ?? "card") === "card",
      );

      if (!cardItems.length) {
        setInventoryNotice("No card-type items found to refresh.");
        return;
      }

      // Fetch prices once per unique cardId, store the full price map
      const uniqueCardIds = Array.from(
        new Set(cardItems.map((item) => item.cardId)),
      );

      const pricesByCardId = await fetchPricesForCardIds(uniqueCardIds);
      const { updatedCount, latestChangesById, csvRows } =
        await refreshCardItems(cardItems, pricesByCardId);

      await reloadInventory();
      setPriceChangeByItemId(latestChangesById);

      const csvCount = csvRows.length;
      if (csvCount > 0) {
        const csv = buildPriceChangeCsv(csvRows);
        const dateTag = new Date().toISOString().slice(0, 10);
        downloadCsv(`price-moves-${dateTag}.csv`, csv);
      }

      const itemWord = plural(updatedCount, "item", "items");
      const cardWord = plural(uniqueCardIds.length, "card", "cards");
      const changeWord = plural(csvCount, "change", "changes");
      setInventoryNotice(
        `Refreshed prices for ${updatedCount} ${itemWord} (${uniqueCardIds.length} unique ${cardWord}). Exported ${csvCount} ${changeWord} with absolute moves >= $3.`,
      );
    } catch (error) {
      console.error("Failed to refresh prices:", error);
      setInventoryNotice("Failed to refresh prices.");
    } finally {
      setRefreshingPrices(false);
    }
  };

  const exportPriceMovesSince = async () => {
    if (!priceMovesSinceDate) {
      setInventoryNotice("Pick a since date first.");
      return;
    }

    setExportingSinceCsv(true);
    setInventoryNotice(null);
    try {
      const response = await axios.get("/api/inventory/price-moves/export", {
        params: {
          since: priceMovesSinceDate,
          threshold: 3,
        },
        responseType: "text",
      });

      downloadCsv(
        `price-moves-since-${priceMovesSinceDate}.csv`,
        String(response.data ?? ""),
      );
      setInventoryNotice(
        `Exported price moves since ${priceMovesSinceDate} (threshold: $3).`,
      );
    } catch (error) {
      console.error("Failed to export price moves since date:", error);
      setInventoryNotice("Failed to export since-date price moves.");
    } finally {
      setExportingSinceCsv(false);
    }
  };

  const addCardToInventory = async (card: SearchCard, price?: number) => {
    // Auto-fill both purchase and current ask prices from the market price when provided
    // Only for card type — sealed/slab should be manually priced
    const shouldUseFetchedPrice = addItemType === "card" && price != null;
    const effectivePurchasePrice = shouldUseFetchedPrice
      ? price
      : Number.parseFloat(purchasePrice) || 0;
    const effectiveCurrentAsk = shouldUseFetchedPrice
      ? price
      : Number.parseFloat(currentAsk) || 0;
    if (shouldUseFetchedPrice) {
      setPurchasePrice(String(price));
      setCurrentAsk(String(price));
    }
    setInventoryNotice(null);
    try {
      await axios.post("/api/inventory", {
        cardId: card.id,
        quantity: Number.parseInt(addQuantity) || 1,
        type: addItemType,
        condition: addCondition,
        storageType: addStorageType,
        pricePurchasedAt: effectivePurchasePrice,
        purchasedAt: purchaseDate,
        purchasedFrom: purchaseSource || undefined,
        priceCurrentAsk:
          effectiveCurrentAsk > 0 ? effectiveCurrentAsk : undefined,
      });
      const params =
        filterStorageType === "all" ? {} : { storageType: filterStorageType };
      const response = await axios.get("/api/inventory", { params });
      setItems(response.data.items);
      setTotalValue(response.data.totalValue);
      setInventoryNotice(`Added ${card.data?.name || card.id} to inventory.`);
      // Reset form defaults
      setAddQuantity("1");
      setAddItemType("card");
      setAddCondition("NM");
      setPurchasePrice("");
      setCurrentAsk("");
      setPurchaseSource("");
      // Close modal after successful add
      closeAddModal();
    } catch (error) {
      console.error("Failed to add inventory item:", error);
      setInventoryNotice("Failed to add card to inventory.");
    }
  };

  const addManualInventoryItem = async () => {
    if (!manualItemName.trim()) {
      setInventoryNotice("Please enter a name for the item.");
      return;
    }

    setIsAddingManual(true);
    setInventoryNotice(null);
    try {
      // Use a placeholder cardId for manual items
      const placeholderCardId = `manual-${addItemType}-${Date.now()}`;

      await axios.post("/api/inventory", {
        cardId: placeholderCardId,
        quantity: Number.parseInt(addQuantity) || 1,
        type: addItemType,
        condition: addCondition,
        storageType: addStorageType,
        pricePurchasedAt: Number.parseFloat(purchasePrice) || 0,
        purchasedAt: purchaseDate,
        purchasedFrom: purchaseSource || undefined,
        priceCurrentAsk:
          (Number.parseFloat(currentAsk) || 0) > 0
            ? Number.parseFloat(currentAsk)
            : undefined,
        notes: manualItemName,
      });
      const params =
        filterStorageType === "all" ? {} : { storageType: filterStorageType };
      const response = await axios.get("/api/inventory", { params });
      setItems(response.data.items);
      setTotalValue(response.data.totalValue);
      setInventoryNotice(`Added ${manualItemName} to inventory.`);
      // Reset form and close modal
      closeAddModal();
    } catch (error) {
      console.error("Failed to add manual inventory item:", error);
      setInventoryNotice("Failed to add item to inventory.");
    } finally {
      setIsAddingManual(false);
    }
  };

  return (
    <div className="inventory-page">
      <h1>Card Inventory</h1>

      <div className="context-panel">
        <div className="context-panel-header">
          <h2>Quick Add Card</h2>
          <p className="panel-description">
            Search cards from the database and click one to add it to inventory.
          </p>
        </div>
        <CardSearchPanel
          title="Find a Card"
          description="Search by name or card number. Click a card to add it."
          onCardSelect={addCardToInventory}
        />
      </div>

      <div className="inventory-controls">
        <Button type="button" onClick={() => setShowAddModal(true)}>
          + Add Item
        </Button>

        <Input
          type="text"
          className="search-input inventory-search-input"
          value={inventorySearch}
          onChange={(e) => {
            setInventorySearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search inventory by name, number, or card id"
          aria-label="Search inventory"
        />

        <div className="filter-buttons">
          <button
            type="button"
            onClick={() => {
              setFilterStorageType("all");
              setPage(1);
              setSortBy(null);
            }}
            className={filterStorageType === "all" ? "active" : ""}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterStorageType("in_case");
              setPage(1);
              setSortBy(null);
            }}
            className={filterStorageType === "in_case" ? "active" : ""}
          >
            In Case
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterStorageType("not_in_case");
              setPage(1);
              setSortBy(null);
            }}
            className={filterStorageType === "not_in_case" ? "active" : ""}
          >
            Not In Case
          </button>
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={() => refreshAllPrices()}
          disabled={refreshingPrices}
          title="Fetch latest prices from TCGPlayer for all cards"
        >
          {refreshingPrices ? "Refreshing Prices..." : "Refresh Prices"}
        </Button>

        <div className="since-export-controls">
          <input
            type="date"
            value={priceMovesSinceDate}
            onChange={(e) => setPriceMovesSinceDate(e.target.value)}
            aria-label="Export price moves since date"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void exportPriceMovesSince()}
            disabled={exportingSinceCsv}
            title="Export current inventory items that moved by at least $3 since selected date"
          >
            {exportingSinceCsv ? "Exporting..." : "Export Since Date CSV"}
          </Button>
        </div>

        <div className="inventory-value">
          Total Value: <strong>${toFiniteNumber(totalValue).toFixed(2)}</strong>
          {totalCount > 0 && (
            <span className="inventory-count">
              {" "}
              &mdash; {totalCount} item{totalCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {loading && <div className="loading">Loading inventory...</div>}

      {!loading && (
        <>
          {!items.length && (
            <div className="search-status-banner">No inventory found.</div>
          )}
          <table className="inventory-table">
            <thead>
              <tr>
                <th></th>
                <th>Card</th>
                <th>Type</th>
                <th>Qty</th>
                <th
                  className="sortable-th"
                  onClick={() => handleSort("condition")}
                >
                  Condition{sortArrow("condition")}
                </th>
                <th>Storage</th>
                <th>Purchase</th>
                <th
                  className="sortable-th"
                  onClick={() => handleSort("priceCurrentAsk")}
                >
                  Ask{sortArrow("priceCurrentAsk")}
                </th>
                <th
                  className="sortable-th"
                  onClick={() => handleSort("totalValue")}
                >
                  Total Value{sortArrow("totalValue")}
                </th>
                <th>Change</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) =>
                (() => {
                  const priceCurrentAsk = toFiniteNumber(
                    item.priceCurrentAsk,
                    -1,
                  );
                  const hasCurrentAsk = priceCurrentAsk >= 0;
                  const change = priceChangeByItemId[item.id];
                  let changeClass = "";
                  if (change) {
                    if (change.delta > 0) {
                      changeClass = "price-change-up";
                    } else if (change.delta < 0) {
                      changeClass = "price-change-down";
                    }
                  }
                  return (
                    <tr key={item.id}>
                      <td className="inventory-image-cell">
                        {item.card?.data?.images?.small &&
                          (item.type ?? "card") === "card" && (
                            <img
                              src={item.card.data.images.small}
                              alt={item.card.data.name}
                              className="inventory-thumb"
                            />
                          )}
                      </td>
                      <td>
                        {item.notes || item.card?.data?.name || item.cardId}
                        {(item.type ?? "card") === "card" &&
                          item.card?.tcgPlayerId && (
                            <a
                              href={`https://www.tcgplayer.com/product/${item.card.tcgPlayerId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tcgplayer-link"
                              title="View on TCGPlayer"
                            >
                              TCG
                            </a>
                          )}
                      </td>
                      <td>{(item.type ?? "card").toUpperCase()}</td>
                      <td>{item.quantity}</td>
                      <td>{normalizeCardCondition(item.condition)}</td>
                      <td>{item.storageType}</td>
                      <td>
                        ${toFiniteNumber(item.pricePurchasedAt).toFixed(2)}
                      </td>
                      <td>
                        {hasCurrentAsk
                          ? `$${priceCurrentAsk.toFixed(2)}`
                          : "N/A"}
                      </td>
                      <td>
                        $
                        {(
                          (hasCurrentAsk
                            ? priceCurrentAsk
                            : toFiniteNumber(item.pricePurchasedAt)) *
                          item.quantity
                        ).toFixed(2)}
                      </td>
                      <td className={changeClass}>
                        {change ? formatPriceChange(change) : "--"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => openEditModal(item)}
                          title="Edit inventory entry"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => void removeInventoryItem(item.id)}
                          title="Remove from inventory"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })(),
              )}
            </tbody>
          </table>

          {totalCount > pageSize && (
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
                Page {page} of {Math.ceil(totalCount / pageSize)}
              </span>
              <button
                type="button"
                className="page-btn"
                onClick={() =>
                  setPage((p) =>
                    Math.min(Math.ceil(totalCount / pageSize), p + 1),
                  )
                }
                disabled={page >= Math.ceil(totalCount / pageSize)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {editingItem && (
        <div
          className="modal-overlay"
          onClick={closeEditModal}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeEditModal();
          }}
          role="presentation"
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>Edit Inventory Item</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeEditModal}
              >
                ✕
              </button>
            </div>

            <div className="modal-form">
              <div className="selected-card-info">
                <strong>
                  {editingItem.notes ||
                    editingItem.card?.data?.name ||
                    editingItem.cardId}
                </strong>
                {editingItem.card?.data?.number && (
                  <span> #{editingItem.card.data.number}</span>
                )}
              </div>

              {editItemType !== "card" && (
                <label className="field-group field-group-wide">
                  <span>Item Name / Description</span>
                  <input
                    type="text"
                    value={editManualItemName}
                    onChange={(e) => setEditManualItemName(e.target.value)}
                    placeholder={
                      editItemType === "sealed"
                        ? "e.g., Pokémon Scarlet/Violet Booster Box"
                        : "e.g., Charizard PSA 9"
                    }
                  />
                </label>
              )}

              <label className="field-group">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                />
              </label>

              <label className="field-group">
                <span>Type</span>
                <select
                  value={editItemType}
                  onChange={(e) =>
                    setEditItemType(e.target.value as InventoryType)
                  }
                >
                  <option value="card">Card</option>
                  <option value="sealed">Sealed</option>
                  <option value="slab">Slab</option>
                </select>
              </label>

              <label className="field-group">
                <span>Storage</span>
                <select
                  value={editStorageType}
                  onChange={(e) =>
                    setEditStorageType(
                      e.target.value as "in_case" | "not_in_case",
                    )
                  }
                >
                  <option value="in_case">In Case</option>
                  <option value="not_in_case">Not In Case</option>
                </select>
              </label>

              <label className="field-group">
                <span>Condition</span>
                <select
                  value={editCondition}
                  onChange={(e) =>
                    setEditCondition(normalizeCardCondition(e.target.value))
                  }
                >
                  {CONDITION_OPTIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-group">
                <span>Purchase Price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editPurchasePrice}
                  onChange={(e) => setEditPurchasePrice(e.target.value)}
                />
              </label>

              <label className="field-group">
                <span>Current Ask</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editCurrentAsk}
                  onChange={(e) => setEditCurrentAsk(e.target.value)}
                />
              </label>

              <div className="modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeEditModal}
                  disabled={editSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveEdits()}
                  disabled={editSaving}
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add to Inventory</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeAddModal}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="context-form-grid">
                <label className="field-group">
                  <span>Type</span>
                  <select
                    value={addItemType}
                    onChange={(e) =>
                      setAddItemType(e.target.value as InventoryType)
                    }
                  >
                    <option value="card">Card</option>
                    <option value="sealed">Sealed</option>
                    <option value="slab">Slab</option>
                  </select>
                </label>

                <label className="field-group">
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="1"
                    value={addQuantity}
                    onChange={(e) => setAddQuantity(e.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span>Storage</span>
                  <select
                    value={addStorageType}
                    onChange={(e) =>
                      setAddStorageType(
                        e.target.value as "in_case" | "not_in_case",
                      )
                    }
                  >
                    <option value="in_case">In Case</option>
                    <option value="not_in_case">Not In Case</option>
                  </select>
                </label>

                <label className="field-group">
                  <span>Condition</span>
                  <select
                    value={addCondition}
                    onChange={(e) =>
                      setAddCondition(normalizeCardCondition(e.target.value))
                    }
                  >
                    {CONDITION_OPTIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {condition}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-group">
                  <span>Purchase Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span>Current Ask</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={currentAsk}
                    onChange={(e) => setCurrentAsk(e.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span>Purchase Date</span>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </label>

                <label className="field-group field-group-wide">
                  <span>Purchased From</span>
                  <input
                    type="text"
                    value={purchaseSource}
                    onChange={(e) => setPurchaseSource(e.target.value)}
                    placeholder="Shop, show, marketplace..."
                  />
                </label>

                <label className="field-group field-group-wide">
                  <span>Item Name / Description</span>
                  <input
                    type="text"
                    value={manualItemName}
                    onChange={(e) => setManualItemName(e.target.value)}
                    placeholder={manualItemPlaceholder}
                  />
                </label>
              </div>

              {inventoryNotice && (
                <div className="search-status-banner">{inventoryNotice}</div>
              )}

              <div className="manual-entry-section">
                <button
                  type="button"
                  onClick={() => void addManualInventoryItem()}
                  disabled={isAddingManual || !manualItemName.trim()}
                  className="add-btn"
                >
                  {isAddingManual
                    ? "Adding..."
                    : `Add ${addItemType.charAt(0).toUpperCase() + addItemType.slice(1)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
