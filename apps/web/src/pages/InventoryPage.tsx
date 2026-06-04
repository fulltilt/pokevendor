import { useEffect, useState } from "react";
import type { FC } from "react";
import axios from "axios";
import {
  CardSearchPanel,
  type SearchCard,
} from "../components/CardSearchPanel";

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

  const normalizedInventorySearch = inventorySearch.trim().toLowerCase();
  const visibleItems = normalizedInventorySearch
    ? items.filter((item) => {
        const label = (item.notes || item.card?.data?.name || item.cardId)
          .toLowerCase()
          .trim();
        const cardNumber = item.card?.data?.number?.toLowerCase() ?? "";
        return (
          label.includes(normalizedInventorySearch) ||
          cardNumber.includes(normalizedInventorySearch) ||
          item.cardId.toLowerCase().includes(normalizedInventorySearch)
        );
      })
    : items;

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

  useEffect(() => {
    const loadInventory = async () => {
      setLoading(true);
      try {
        const params: Record<string, string | number> =
          filterStorageType === "all" ? {} : { storageType: filterStorageType };
        params.limit = pageSize;
        params.offset = (page - 1) * pageSize;
        if (sortBy) {
          params.sortBy = sortBy;
          params.sortDir = sortDir;
        }
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
  }, [filterStorageType, page, sortBy, sortDir]);

  const reloadInventory = async () => {
    const params: Record<string, string | number> =
      filterStorageType === "all" ? {} : { storageType: filterStorageType };
    params.limit = pageSize;
    params.offset = (page - 1) * pageSize;
    if (sortBy) {
      params.sortBy = sortBy;
      params.sortDir = sortDir;
    }
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
    setEditCurrentAsk(
      String(
        item.priceCurrentAsk != null
          ? toFiniteNumber(item.priceCurrentAsk)
          : toFiniteNumber(item.pricePurchasedAt),
      ),
    );
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
    if (!items.length) {
      setInventoryNotice("No items to refresh.");
      return;
    }

    setRefreshingPrices(true);
    setInventoryNotice(null);

    try {
      // Only refresh card-type items; skip sealed/slab
      const cardItems = items.filter(
        (item) => (item.type ?? "card") === "card",
      );

      // Fetch prices once per unique cardId, store the full price map
      const uniqueCardIds = Array.from(
        new Set(cardItems.map((item) => item.cardId)),
      );

      const pricesByCardId: Record<
        string,
        { nm: number | null; lp: number | null; mp: number | null } | null
      > = {};

      for (const cardId of uniqueCardIds) {
        try {
          const priceRes = await axios.get<{
            prices: {
              nm: number | null;
              lp: number | null;
              mp: number | null;
            } | null;
          }>(`/api/cards/${cardId}/prices`);
          pricesByCardId[cardId] = priceRes.data.prices ?? null;
        } catch (error) {
          console.error(`Failed to fetch price for card ${cardId}:`, error);
          pricesByCardId[cardId] = null;
        }
      }

      // Update each item using its own condition against the fetched price map
      let updatedCount = 0;
      for (const item of cardItems) {
        const prices = pricesByCardId[item.cardId];
        if (!prices) continue;

        const normalizedCondition = normalizeCardCondition(item.condition);
        const newPrice = pickPriceByCondition(prices, normalizedCondition);
        if (newPrice === null) continue;

        try {
          await axios.patch(`/api/inventory/${item.id}`, {
            priceCurrentAsk: newPrice,
          });
          updatedCount++;
        } catch (error) {
          console.error(`Failed to update price for item ${item.id}:`, error);
        }
      }

      await reloadInventory();
      setInventoryNotice(
        `Refreshed prices for ${updatedCount} item${updatedCount !== 1 ? "s" : ""} (${uniqueCardIds.length} unique card${uniqueCardIds.length !== 1 ? "s" : ""}).`,
      );
    } catch (error) {
      console.error("Failed to refresh prices:", error);
      setInventoryNotice("Failed to refresh prices.");
    } finally {
      setRefreshingPrices(false);
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
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="btn-primary"
        >
          + Add Item
        </button>

        <input
          type="text"
          className="search-input inventory-search-input"
          value={inventorySearch}
          onChange={(e) => setInventorySearch(e.target.value)}
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

        <button
          type="button"
          className="btn-secondary"
          onClick={() => refreshAllPrices()}
          disabled={refreshingPrices}
          title="Fetch latest prices from TCGPlayer for all cards"
        >
          {refreshingPrices ? "Refreshing Prices..." : "Refresh Prices"}
        </button>

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
          {!visibleItems.length && (
            <div className="search-status-banner">
              No inventory matches "{inventorySearch.trim()}".
            </div>
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) =>
                (() => {
                  const priceCurrentAsk = toFiniteNumber(
                    item.priceCurrentAsk,
                    -1,
                  );
                  const hasCurrentAsk = priceCurrentAsk >= 0;
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
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeEditModal}
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void saveEdits()}
                  disabled={editSaving}
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
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
