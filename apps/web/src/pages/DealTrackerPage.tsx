import { useEffect, useState } from "react";
import type { FC } from "react";
import axios from "axios";
import {
  CardSearchPanel,
  type SearchCard,
} from "../components/CardSearchPanel";

interface DealItem {
  id: string;
  cardId?: string;
  direction: string;
  quantity: number;
  price: number | string | null;
  itemType: string;
  notes?: string | null;
  card?: SearchCard;
}

interface LocationOption {
  name: string;
}

interface Deal {
  id: string;
  location?: string;
  incoming: DealItem[];
  outgoing: DealItem[];
}

interface InventorySearchItem {
  id: string;
  cardId: string;
  quantity: number;
  pricePurchasedAt: number | string;
  priceCurrentAsk?: number | string | null;
  notes?: string | null;
  card?: SearchCard;
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const DealTrackerPage: FC = () => {
  const [currentDeal, setCurrentDeal] = useState<Deal | null>(null);
  const [location, setLocation] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [incomingTotal, setIncomingTotal] = useState(0);
  const [outgoingTotal, setOutgoingTotal] = useState(0);
  const [itemQuantity, setItemQuantity] = useState("1");
  const [itemPrice, setItemPrice] = useState("");
  const [dealNotice, setDealNotice] = useState<string | null>(null);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);
  const [inventoryPool, setInventoryPool] = useState<InventorySearchItem[]>([]);
  const [outgoingSearch, setOutgoingSearch] = useState("");
  const [loadingOutgoingInventory, setLoadingOutgoingInventory] =
    useState(false);

  // Edit deal item modal
  const [editingDealItem, setEditingDealItem] = useState<DealItem | null>(null);
  const [editDealQuantity, setEditDealQuantity] = useState("1");
  const [editDealPrice, setEditDealPrice] = useState("");
  const [editDealNotes, setEditDealNotes] = useState("");
  const [editDealSaving, setEditDealSaving] = useState(false);

  // Manual incoming (sealed/slab)
  const [showManualIncoming, setShowManualIncoming] = useState(false);
  const [manualIncomingType, setManualIncomingType] = useState<
    "sealed" | "slab"
  >("sealed");
  const [manualIncomingName, setManualIncomingName] = useState("");
  const [manualIncomingQty, setManualIncomingQty] = useState("1");
  const [manualIncomingPrice, setManualIncomingPrice] = useState("");
  const [isSubmittingManualIncoming, setIsSubmittingManualIncoming] =
    useState(false);

  // Manual outgoing (sealed/slab)
  const [showManualOutgoing, setShowManualOutgoing] = useState(false);
  const [manualOutgoingType, setManualOutgoingType] = useState<
    "sealed" | "slab"
  >("sealed");
  const [manualOutgoingName, setManualOutgoingName] = useState("");
  const [manualOutgoingQty, setManualOutgoingQty] = useState("1");
  const [manualOutgoingPrice, setManualOutgoingPrice] = useState("");
  const [isSubmittingManualOutgoing, setIsSubmittingManualOutgoing] =
    useState(false);

  const fetchDealDetails = async (dealId: string) => {
    const response = await axios.get(`/api/deals/${dealId}`);
    setCurrentDeal(response.data.deal);
    setIncomingTotal(response.data.incomingTotal);
    setOutgoingTotal(response.data.outgoingTotal);
  };

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const response = await axios.get("/api/locations");
        setLocations(response.data.map((loc: LocationOption) => loc.name));
      } catch (error) {
        console.error("Failed to fetch locations:", error);
      }
    };

    void loadLocations();
  }, []);

  useEffect(() => {
    const loadInventoryPool = async () => {
      if (!currentDeal) {
        setInventoryPool([]);
        return;
      }

      setLoadingOutgoingInventory(true);
      try {
        const response = await axios.get("/api/inventory", {
          params: { limit: 500, offset: 0 },
        });
        setInventoryPool(response.data.items ?? []);
      } catch (error) {
        console.error("Failed to fetch inventory pool:", error);
        setDealNotice("Failed to load inventory options for outgoing items.");
      } finally {
        setLoadingOutgoingInventory(false);
      }
    };

    void loadInventoryPool();
  }, [currentDeal]);

  const createNewDeal = async () => {
    try {
      const response = await axios.post("/api/deals", { location });
      await fetchDealDetails(response.data.id);
      setDealNotice(
        "Deal started. Use incoming search for buys and inventory search for outgoing.",
      );
    } catch (error) {
      console.error("Failed to create deal:", error);
      setDealNotice("Failed to start deal.");
    }
  };

  const addCardToDeal = async (card: SearchCard, price?: number) => {
    if (!currentDeal) {
      return;
    }

    // Incoming side uses the card database search.
    const effectivePrice = (price ?? Number.parseFloat(itemPrice)) || 0;
    if (price != null) {
      setItemPrice(String(price));
    }
    setDealNotice(null);
    try {
      await axios.post(`/api/deals/${currentDeal.id}/items`, {
        cardId: card.id,
        direction: "incoming",
        quantity: Number.parseInt(itemQuantity) || 1,
        price: effectivePrice,
        itemType: "card",
      });
      await fetchDealDetails(currentDeal.id);
      setDealNotice(`Added ${card.data?.name || card.id} to incoming.`);
    } catch (error) {
      console.error("Failed to add deal item:", error);
      setDealNotice("Failed to add card to the deal.");
    }
  };

  const addOutgoingFromInventory = async (
    cardId: string,
    suggestedPrice: number,
    cardLabel: string,
    availableQuantity: number,
  ) => {
    if (!currentDeal) {
      return;
    }

    if ((Number.parseInt(itemQuantity) || 1) > availableQuantity) {
      setDealNotice(
        `Only ${availableQuantity} available in inventory for ${cardLabel}.`,
      );
      return;
    }

    const parsedItemPrice = Number.parseFloat(itemPrice) || 0;
    const effectivePrice =
      parsedItemPrice > 0 ? parsedItemPrice : suggestedPrice;
    setDealNotice(null);
    try {
      await axios.post(`/api/deals/${currentDeal.id}/items`, {
        cardId,
        direction: "outgoing",
        quantity: Number.parseInt(itemQuantity) || 1,
        price: effectivePrice,
        itemType: "card",
      });
      await fetchDealDetails(currentDeal.id);
      setDealNotice(`Added ${cardLabel} to outgoing from inventory.`);
    } catch (error) {
      console.error("Failed to add outgoing deal item:", error);
      setDealNotice("Failed to add outgoing card from inventory.");
    }
  };

  const removeDealItem = async (itemId: string) => {
    if (!currentDeal) return;
    try {
      await axios.delete(`/api/deals/items/${itemId}`);
      await fetchDealDetails(currentDeal.id);
    } catch (error) {
      console.error("Failed to remove deal item:", error);
    }
  };

  const openEditDealItem = (item: DealItem) => {
    setEditingDealItem(item);
    setEditDealQuantity(String(item.quantity));
    setEditDealPrice(String(toFiniteNumber(item.price)));
    setEditDealNotes(item.notes ?? "");
  };

  const closeEditDealItem = () => {
    setEditingDealItem(null);
    setEditDealSaving(false);
  };

  const saveDealItemEdits = async () => {
    if (!editingDealItem || !currentDeal) return;
    setEditDealSaving(true);
    try {
      await axios.patch(`/api/deals/items/${editingDealItem.id}`, {
        quantity: Number.parseInt(editDealQuantity) || 1,
        price: Number.parseFloat(editDealPrice) || 0,
        ...(editingDealItem.itemType !== "card" && { notes: editDealNotes }),
      });
      await fetchDealDetails(currentDeal.id);
      closeEditDealItem();
    } catch (error) {
      console.error("Failed to update deal item:", error);
    } finally {
      setEditDealSaving(false);
    }
  };

  const addManualIncomingItem = async () => {
    if (!currentDeal || !manualIncomingName.trim()) return;
    setIsSubmittingManualIncoming(true);
    try {
      await axios.post(`/api/deals/${currentDeal.id}/items`, {
        direction: "incoming",
        quantity: Number.parseInt(manualIncomingQty) || 1,
        price: Number.parseFloat(manualIncomingPrice) || 0,
        itemType: manualIncomingType,
        notes: manualIncomingName.trim(),
      });
      await fetchDealDetails(currentDeal.id);
      setManualIncomingName("");
      setManualIncomingQty("1");
      setManualIncomingPrice("");
      setShowManualIncoming(false);
      setDealNotice(`Added ${manualIncomingType} to incoming.`);
    } catch (error) {
      console.error("Failed to add manual incoming item:", error);
      setDealNotice("Failed to add item.");
    } finally {
      setIsSubmittingManualIncoming(false);
    }
  };

  const addManualOutgoingItem = async () => {
    if (!currentDeal || !manualOutgoingName.trim()) return;
    setIsSubmittingManualOutgoing(true);
    try {
      await axios.post(`/api/deals/${currentDeal.id}/items`, {
        direction: "outgoing",
        quantity: Number.parseInt(manualOutgoingQty) || 1,
        price: Number.parseFloat(manualOutgoingPrice) || 0,
        itemType: manualOutgoingType,
        notes: manualOutgoingName.trim(),
      });
      await fetchDealDetails(currentDeal.id);
      setManualOutgoingName("");
      setManualOutgoingQty("1");
      setManualOutgoingPrice("");
      setShowManualOutgoing(false);
      setDealNotice(`Added ${manualOutgoingType} to outgoing.`);
    } catch (error) {
      console.error("Failed to add manual outgoing item:", error);
      setDealNotice("Failed to add item.");
    } finally {
      setIsSubmittingManualOutgoing(false);
    }
  };

  const finalizeDeal = async () => {
    if (!currentDeal) return;
    try {
      await axios.post(`/api/deals/${currentDeal.id}/finalize`);
      setCurrentDeal(null);
      setIncomingTotal(0);
      setOutgoingTotal(0);
      setDealNotice("Deal finalized.");
    } catch (error) {
      console.error("Failed to finalize deal:", error);
      setDealNotice("Failed to finalize deal.");
    }
  };

  const createLocation = async () => {
    if (!newLocationName.trim()) {
      setDealNotice("Location name cannot be empty.");
      return;
    }

    setIsCreatingLocation(true);
    try {
      const response = await axios.post("/api/locations", {
        name: newLocationName.trim(),
      });
      setLocations([...locations, response.data.name].sort());
      setNewLocationName("");
      setShowLocationForm(false);
      setLocation(response.data.name);
      setDealNotice(`Location "${response.data.name}" created.`);
    } catch (error: any) {
      if (error.response?.status === 409) {
        setDealNotice("Location already exists.");
      } else {
        setDealNotice("Failed to create location.");
      }
      console.error("Failed to create location:", error);
    } finally {
      setIsCreatingLocation(false);
    }
  };

  const netCash = outgoingTotal - incomingTotal;
  let netCashClass = "neutral";
  if (netCash > 0) {
    netCashClass = "positive";
  } else if (netCash < 0) {
    netCashClass = "negative";
  }

  const outgoingReservedByCardId = (currentDeal?.outgoing ?? []).reduce(
    (acc, item) => {
      if (!item.cardId) return acc;
      acc[item.cardId] = (acc[item.cardId] ?? 0) + item.quantity;
      return acc;
    },
    {} as Record<string, number>,
  );

  const outgoingSearchLower = outgoingSearch.trim().toLowerCase();
  const outgoingCandidates = Array.from(
    inventoryPool.reduce(
      (acc, item) => {
        const existing = acc.get(item.cardId);
        const itemName = item.notes || item.card?.data?.name || item.cardId;
        const itemNumber = item.card?.data?.number ?? "";
        const suggestedPrice = toFiniteNumber(
          item.priceCurrentAsk,
          toFiniteNumber(item.pricePurchasedAt),
        );

        if (existing) {
          existing.totalQuantity += item.quantity;
          if (existing.suggestedPrice <= 0 && suggestedPrice > 0) {
            existing.suggestedPrice = suggestedPrice;
          }
          return acc;
        }

        acc.set(item.cardId, {
          cardId: item.cardId,
          itemName,
          itemNumber,
          totalQuantity: item.quantity,
          suggestedPrice,
        });
        return acc;
      },
      new Map<
        string,
        {
          cardId: string;
          itemName: string;
          itemNumber: string;
          totalQuantity: number;
          suggestedPrice: number;
        }
      >(),
    ),
  )
    .map(([, candidate]) => {
      const reserved = outgoingReservedByCardId[candidate.cardId] ?? 0;
      return {
        ...candidate,
        availableQuantity: Math.max(0, candidate.totalQuantity - reserved),
      };
    })
    .filter((candidate) => candidate.availableQuantity > 0)
    .filter((candidate) => {
      if (!outgoingSearchLower) return true;
      return (
        candidate.itemName.toLowerCase().includes(outgoingSearchLower) ||
        candidate.itemNumber.toLowerCase().includes(outgoingSearchLower) ||
        candidate.cardId.toLowerCase().includes(outgoingSearchLower)
      );
    })
    .slice(0, 30);

  return (
    <div className="deal-tracker-page">
      <h1>Deal Tracker</h1>

      <div className="deal-controls">
        {!currentDeal && (
          <>
            <div className="new-deal-form">
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="">Select Location</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <button type="button" onClick={createNewDeal}>
                Start Deal
              </button>
              <button
                type="button"
                onClick={() => setShowLocationForm(!showLocationForm)}
                className="secondary-btn"
              >
                {showLocationForm ? "Cancel" : "+ Add Location"}
              </button>
            </div>

            {showLocationForm && (
              <div className="location-form-modal">
                <div
                  className="modal-overlay"
                  onClick={() => setShowLocationForm(false)}
                />
                <div className="modal-content">
                  <h3>Add New Location</h3>
                  <div className="location-form-group">
                    <input
                      type="text"
                      placeholder="Enter location name (e.g., Local Game Store, Home)"
                      value={newLocationName}
                      onChange={(e) => setNewLocationName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void createLocation();
                        }
                      }}
                      disabled={isCreatingLocation}
                      autoFocus
                    />
                  </div>
                  <div className="modal-actions">
                    <button
                      type="button"
                      onClick={() => setShowLocationForm(false)}
                      disabled={isCreatingLocation}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void createLocation()}
                      disabled={isCreatingLocation || !newLocationName.trim()}
                    >
                      {isCreatingLocation ? "Creating..." : "Create Location"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {dealNotice && <div className="search-status-banner">{dealNotice}</div>}

        {currentDeal && (
          <>
            <div className="deal-summary">
              <h3>
                Current Deal at {currentDeal.location || "Unspecified Location"}
              </h3>

              <div className="deal-totals">
                <div className="total-item">
                  <span>Incoming:</span>
                  <strong>${incomingTotal.toFixed(2)}</strong>
                </div>
                <div className="total-item">
                  <span>Outgoing:</span>
                  <strong>${outgoingTotal.toFixed(2)}</strong>
                </div>
                <div className={`net-cash ${netCashClass}`}>
                  <span>Net Cash:</span>
                  <strong>${netCash.toFixed(2)}</strong>
                </div>
              </div>

              <button
                type="button"
                onClick={finalizeDeal}
                className="finalize-btn"
              >
                Finalize Deal
              </button>
            </div>

            <div className="context-panel">
              <div className="context-panel-header">
                <h2>Add Incoming Cards</h2>
                <p className="panel-description">
                  Search the card database and click a result to add it to the
                  incoming side.
                </p>
              </div>

              <div className="context-form-grid">
                <label className="field-group">
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="1"
                    value={itemQuantity}
                    onChange={(e) => setItemQuantity(e.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span>Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                  />
                </label>
              </div>

              <CardSearchPanel
                title="Find a Card"
                description="Search by name or card number. Clicking a result adds it to incoming."
                onCardSelect={addCardToDeal}
              />

              <div className="manual-entry-section">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowManualIncoming(!showManualIncoming)}
                >
                  {showManualIncoming ? "▲ Cancel" : "+ Add Sealed / Slab"}
                </button>

                {showManualIncoming && (
                  <div className="manual-entry-form">
                    <div className="context-form-grid">
                      <label className="field-group">
                        <span>Type</span>
                        <select
                          value={manualIncomingType}
                          onChange={(e) =>
                            setManualIncomingType(
                              e.target.value as "sealed" | "slab",
                            )
                          }
                        >
                          <option value="sealed">Sealed</option>
                          <option value="slab">Slab</option>
                        </select>
                      </label>

                      <label className="field-group">
                        <span>Name / Description</span>
                        <input
                          type="text"
                          placeholder="e.g. Surging Sparks booster box"
                          value={manualIncomingName}
                          onChange={(e) =>
                            setManualIncomingName(e.target.value)
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Quantity</span>
                        <input
                          type="number"
                          min="1"
                          value={manualIncomingQty}
                          onChange={(e) => setManualIncomingQty(e.target.value)}
                        />
                      </label>

                      <label className="field-group">
                        <span>Price</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualIncomingPrice}
                          onChange={(e) =>
                            setManualIncomingPrice(e.target.value)
                          }
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      disabled={
                        !manualIncomingName.trim() || isSubmittingManualIncoming
                      }
                      onClick={() => void addManualIncomingItem()}
                    >
                      {isSubmittingManualIncoming
                        ? "Adding..."
                        : "Add to Incoming"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="context-panel">
              <div className="context-panel-header">
                <h2>Add Outgoing from Inventory</h2>
                <p className="panel-description">
                  Only cards currently in inventory can be added to outgoing.
                </p>
              </div>

              <label className="field-group field-group-wide">
                <span>Search Inventory</span>
                <input
                  type="text"
                  className="search-input"
                  value={outgoingSearch}
                  onChange={(e) => setOutgoingSearch(e.target.value)}
                  placeholder="Search inventory by name, number, or card id"
                />
              </label>

              {loadingOutgoingInventory && (
                <div className="loading">Loading inventory options...</div>
              )}

              {!loadingOutgoingInventory && !outgoingCandidates.length && (
                <div className="search-status-banner">
                  No inventory cards available for outgoing.
                </div>
              )}

              {!loadingOutgoingInventory && outgoingCandidates.length > 0 && (
                <div className="deal-outgoing-list">
                  {outgoingCandidates.map((candidate) => (
                    <div key={candidate.cardId} className="deal-item-row">
                      <span className="deal-item-name">
                        {candidate.itemName}
                      </span>
                      <span className="deal-item-price">
                        Available: {candidate.availableQuantity} | Suggested: $
                        {candidate.suggestedPrice.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={
                          (Number.parseInt(itemQuantity) || 1) >
                          candidate.availableQuantity
                        }
                        onClick={() =>
                          void addOutgoingFromInventory(
                            candidate.cardId,
                            candidate.suggestedPrice,
                            candidate.itemName,
                            candidate.availableQuantity,
                          )
                        }
                      >
                        Add to Outgoing
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="manual-entry-section">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowManualOutgoing(!showManualOutgoing)}
                >
                  {showManualOutgoing
                    ? "▲ Cancel"
                    : "+ Add Sealed / Slab to Outgoing"}
                </button>

                {showManualOutgoing && (
                  <div className="manual-entry-form">
                    <div className="context-form-grid">
                      <label className="field-group">
                        <span>Type</span>
                        <select
                          value={manualOutgoingType}
                          onChange={(e) =>
                            setManualOutgoingType(
                              e.target.value as "sealed" | "slab",
                            )
                          }
                        >
                          <option value="sealed">Sealed</option>
                          <option value="slab">Slab</option>
                        </select>
                      </label>

                      <label className="field-group">
                        <span>Name / Description</span>
                        <input
                          type="text"
                          placeholder="e.g. Pikachu PSA 10"
                          value={manualOutgoingName}
                          onChange={(e) =>
                            setManualOutgoingName(e.target.value)
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Quantity</span>
                        <input
                          type="number"
                          min="1"
                          value={manualOutgoingQty}
                          onChange={(e) => setManualOutgoingQty(e.target.value)}
                        />
                      </label>

                      <label className="field-group">
                        <span>Price</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualOutgoingPrice}
                          onChange={(e) =>
                            setManualOutgoingPrice(e.target.value)
                          }
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      disabled={
                        !manualOutgoingName.trim() || isSubmittingManualOutgoing
                      }
                      onClick={() => void addManualOutgoingItem()}
                    >
                      {isSubmittingManualOutgoing
                        ? "Adding..."
                        : "Add to Outgoing"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="deal-item-columns">
              {(["incoming", "outgoing"] as const).map((col) => (
                <section
                  key={col}
                  className="deal-item-column"
                  aria-label={`${col === "incoming" ? "Incoming" : "Outgoing"} cards`}
                >
                  <h3>{col === "incoming" ? "Incoming" : "Outgoing"} Cards</h3>
                  {currentDeal[col].length === 0 && (
                    <div className="empty-deal-items">No items yet.</div>
                  )}
                  {currentDeal[col].map((item) => (
                    <div key={item.id} className="deal-item-row">
                      <span className="deal-item-name">
                        {item.notes ||
                          item.card?.data?.name ||
                          item.cardId ||
                          item.itemType}
                        {item.itemType !== "card" && (
                          <span className="item-type-badge">
                            {" "}
                            [{item.itemType}]
                          </span>
                        )}
                      </span>
                      <span className="deal-item-price">
                        {item.quantity} × $
                        {toFiniteNumber(item.price).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        className="edit-btn"
                        onClick={() => openEditDealItem(item)}
                        title="Edit item"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => void removeDealItem(item.id)}
                        title="Remove from deal"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {editingDealItem && (
        <div className="location-form-modal">
          <div className="modal-overlay" onClick={closeEditDealItem} />
          <div className="modal-content">
            <div className="modal-header">
              <h3>
                Edit{" "}
                {editingDealItem.notes ||
                  editingDealItem.card?.data?.name ||
                  editingDealItem.cardId ||
                  editingDealItem.itemType}
              </h3>
            </div>

            <div className="modal-body">
              <div className="context-form-grid">
                {editingDealItem.itemType !== "card" && (
                  <label className="field-group field-group-wide">
                    <span>Name / Description</span>
                    <input
                      type="text"
                      value={editDealNotes}
                      onChange={(e) => setEditDealNotes(e.target.value)}
                      placeholder="Item description"
                    />
                  </label>
                )}

                <label className="field-group">
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="1"
                    value={editDealQuantity}
                    onChange={(e) => setEditDealQuantity(e.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span>Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editDealPrice}
                    onChange={(e) => setEditDealPrice(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeEditDealItem}
                disabled={editDealSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveDealItemEdits()}
                disabled={editDealSaving}
              >
                {editDealSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
