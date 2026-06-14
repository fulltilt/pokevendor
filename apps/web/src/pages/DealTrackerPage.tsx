import { useEffect, useState } from "react";
import type { ChangeEvent, FC } from "react";
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

interface DraftDeal {
  id: string;
  location?: string | null;
  dateCreated: string;
  incoming: DealItem[];
  outgoing: DealItem[];
  incomingTotal: number;
  outgoingTotal: number;
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
  const [draftDeals, setDraftDeals] = useState<DraftDeal[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [currentDeal, setCurrentDeal] = useState<Deal | null>(null);
  const [location, setLocation] = useState(() => {
    // Load last location from localStorage on mount
    if (typeof window !== "undefined") {
      return localStorage.getItem("lastDealLocation") || "";
    }
    return "";
  });
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

  // Manual incoming card (by name, not from search)
  const [showManualIncomingCard, setShowManualIncomingCard] = useState(false);
  const [manualCardIncomingName, setManualCardIncomingName] = useState("");
  const [manualCardIncomingQty, setManualCardIncomingQty] = useState("1");
  const [manualCardIncomingPrice, setManualCardIncomingPrice] = useState("");
  const [isSubmittingManualIncomingCard, setIsSubmittingManualIncomingCard] =
    useState(false);

  // Manual outgoing card (by name, not from search)
  const [showManualOutgoingCard, setShowManualOutgoingCard] = useState(false);
  const [manualCardOutgoingName, setManualCardOutgoingName] = useState("");
  const [manualCardOutgoingQty, setManualCardOutgoingQty] = useState("1");
  const [manualCardOutgoingPrice, setManualCardOutgoingPrice] = useState("");
  const [isSubmittingManualOutgoingCard, setIsSubmittingManualOutgoingCard] =
    useState(false);

  const [targetNetCash, setTargetNetCash] = useState("0");
  const [isApplyingCash, setIsApplyingCash] = useState(false);
  const [outgoingTradePercentage, setOutgoingTradePercentage] = useState(80);
  const [isApplyingOutgoingPercentage, setIsApplyingOutgoingPercentage] =
    useState(false);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [scanPhotoName, setScanPhotoName] = useState("");
  const [scanStatus, setScanStatus] = useState(
    "No photo selected. Capture a card photo to begin.",
  );
  const [scanCandidates, setScanCandidates] = useState<SearchCard[]>([]);
  const [loadingScanCandidates, setLoadingScanCandidates] = useState(false);

  const fetchDealDetails = async (dealId: string) => {
    const response = await axios.get(`/api/deals/${dealId}`);
    setCurrentDeal(response.data.deal);
    setIncomingTotal(response.data.incomingTotal);
    setOutgoingTotal(response.data.outgoingTotal);
  };

  const loadDraftDeals = async () => {
    setLoadingDrafts(true);
    try {
      const response = await axios.get("/api/deals", {
        params: { status: "pending", limit: 100 },
      });
      setDraftDeals(response.data.deals ?? []);
    } catch (error) {
      console.error("Failed to load draft deals:", error);
    } finally {
      setLoadingDrafts(false);
    }
  };

  const deleteDraftDeal = async (dealId: string) => {
    try {
      await axios.delete(`/api/deals/${dealId}`);
      setDraftDeals((prev) => prev.filter((d) => d.id !== dealId));
    } catch (error) {
      console.error("Failed to delete draft deal:", error);
      setDealNotice("Failed to delete draft deal.");
    }
  };

  // Load draft deals on mount
  useEffect(() => {
    void loadDraftDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Persist location to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("lastDealLocation", location);
      }
      await fetchDealDetails(response.data.id);
      // Keep location selected for next deal
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

  const addManualIncomingCard = async () => {
    if (!currentDeal || !manualCardIncomingName.trim()) return;
    setIsSubmittingManualIncomingCard(true);
    try {
      await axios.post(`/api/deals/${currentDeal.id}/items`, {
        direction: "incoming",
        quantity: Number.parseInt(manualCardIncomingQty) || 1,
        price: Number.parseFloat(manualCardIncomingPrice) || 0,
        itemType: "card",
        notes: manualCardIncomingName.trim(),
      });
      await fetchDealDetails(currentDeal.id);
      setManualCardIncomingName("");
      setManualCardIncomingQty("1");
      setManualCardIncomingPrice("");
      setShowManualIncomingCard(false);
      setDealNotice(`Added card to incoming.`);
    } catch (error) {
      console.error("Failed to add manual incoming card:", error);
      setDealNotice("Failed to add card.");
    } finally {
      setIsSubmittingManualIncomingCard(false);
    }
  };

  const addManualOutgoingCard = async () => {
    if (!currentDeal || !manualCardOutgoingName.trim()) return;
    setIsSubmittingManualOutgoingCard(true);
    try {
      await axios.post(`/api/deals/${currentDeal.id}/items`, {
        direction: "outgoing",
        quantity: Number.parseInt(manualCardOutgoingQty) || 1,
        price: Number.parseFloat(manualCardOutgoingPrice) || 0,
        itemType: "card",
        notes: manualCardOutgoingName.trim(),
      });
      await fetchDealDetails(currentDeal.id);
      setManualCardOutgoingName("");
      setManualCardOutgoingQty("1");
      setManualCardOutgoingPrice("");
      setShowManualOutgoingCard(false);
      setDealNotice(`Added card to outgoing.`);
    } catch (error) {
      console.error("Failed to add manual outgoing card:", error);
      setDealNotice("Failed to add card.");
    } finally {
      setIsSubmittingManualOutgoingCard(false);
    }
  };

  const finalizeDeal = async () => {
    if (!currentDeal) return;
    try {
      await axios.post(`/api/deals/${currentDeal.id}/finalize`);
      setCurrentDeal(null);
      setIncomingTotal(0);
      setOutgoingTotal(0);
      void loadDraftDeals();
      setDealNotice("Deal finalized.");
    } catch (error) {
      console.error("Failed to finalize deal:", error);
      setDealNotice("Failed to finalize deal.");
    }
  };

  const applyOutgoingPercentage = async () => {
    if (!currentDeal) return;

    const incomingNonCashItems = (currentDeal.incoming ?? []).filter(
      (item) => item.itemType !== "cash",
    );

    if (incomingNonCashItems.length === 0) {
      setDealNotice("No incoming items to apply percentage to.");
      return;
    }

    setIsApplyingOutgoingPercentage(true);
    setDealNotice(null);

    try {
      await Promise.all(
        incomingNonCashItems.map((item) => {
          const basePrice = toFiniteNumber(item.price);
          const adjustedPrice = Number(
            (basePrice * (outgoingTradePercentage / 100)).toFixed(2),
          );

          return axios.patch(`/api/deals/items/${item.id}`, {
            quantity: item.quantity,
            price: adjustedPrice,
            ...(item.itemType !== "card" && { notes: item.notes ?? "" }),
          });
        }),
      );

      await fetchDealDetails(currentDeal.id);
      setDealNotice(
        `Applied ${outgoingTradePercentage}% to incoming item prices.`,
      );
    } catch (error) {
      console.error("Failed to apply outgoing percentage:", error);
      setDealNotice("Failed to apply percentage to incoming items.");
    } finally {
      setIsApplyingOutgoingPercentage(false);
    }
  };

  const applyNetCashTarget = async () => {
    if (!currentDeal) return;

    const parsedTarget = Number.parseFloat(targetNetCash);
    if (!Number.isFinite(parsedTarget)) {
      setDealNotice("Enter a valid net cash amount.");
      return;
    }

    const currentIncomingTotal = (currentDeal.incoming ?? []).reduce(
      (sum, item) => sum + toFiniteNumber(item.price) * item.quantity,
      0,
    );
    const currentOutgoingTotal = (currentDeal.outgoing ?? []).reduce(
      (sum, item) => sum + toFiniteNumber(item.price) * item.quantity,
      0,
    );
    const currentNetCash = currentOutgoingTotal - currentIncomingTotal;
    const neededDelta = parsedTarget - currentNetCash;

    if (Math.abs(neededDelta) < 0.005) {
      setDealNotice("Net cash is already at the target amount.");
      return;
    }

    const cashIncomingItems = (currentDeal.incoming ?? []).filter(
      (item) => item.itemType === "cash",
    );
    const cashOutgoingItems = (currentDeal.outgoing ?? []).filter(
      (item) => item.itemType === "cash",
    );

    const currentCashIncomingTotal = cashIncomingItems.reduce(
      (sum, item) => sum + toFiniteNumber(item.price) * item.quantity,
      0,
    );
    const currentCashOutgoingTotal = cashOutgoingItems.reduce(
      (sum, item) => sum + toFiniteNumber(item.price) * item.quantity,
      0,
    );
    const currentCashAdjustment =
      currentCashOutgoingTotal - currentCashIncomingTotal;
    const nextCashAdjustment = Number(
      (currentCashAdjustment + neededDelta).toFixed(2),
    );

    const deleteAllCashItems = async () => {
      const allCashItems = [...cashIncomingItems, ...cashOutgoingItems];
      await Promise.all(
        allCashItems.map((item) => axios.delete(`/api/deals/items/${item.id}`)),
      );
    };

    setIsApplyingCash(true);
    setDealNotice(null);
    try {
      if (Math.abs(nextCashAdjustment) < 0.005) {
        await deleteAllCashItems();
      } else if (nextCashAdjustment > 0) {
        const amount = Number(nextCashAdjustment.toFixed(2));

        if (cashOutgoingItems.length > 0) {
          await axios.patch(`/api/deals/items/${cashOutgoingItems[0].id}`, {
            quantity: 1,
            price: amount,
            notes: "Cash",
          });
          if (cashOutgoingItems.length > 1) {
            await Promise.all(
              cashOutgoingItems
                .slice(1)
                .map((item) => axios.delete(`/api/deals/items/${item.id}`)),
            );
          }
        } else {
          await axios.post(`/api/deals/${currentDeal.id}/items`, {
            direction: "outgoing",
            quantity: 1,
            price: amount,
            itemType: "cash",
            notes: "Cash",
          });
        }

        await Promise.all(
          cashIncomingItems.map((item) =>
            axios.delete(`/api/deals/items/${item.id}`),
          ),
        );
      } else {
        const amount = Number(Math.abs(nextCashAdjustment).toFixed(2));

        if (cashIncomingItems.length > 0) {
          await axios.patch(`/api/deals/items/${cashIncomingItems[0].id}`, {
            quantity: 1,
            price: amount,
            notes: "Cash",
          });
          if (cashIncomingItems.length > 1) {
            await Promise.all(
              cashIncomingItems
                .slice(1)
                .map((item) => axios.delete(`/api/deals/items/${item.id}`)),
            );
          }
        } else {
          await axios.post(`/api/deals/${currentDeal.id}/items`, {
            direction: "incoming",
            quantity: 1,
            price: amount,
            itemType: "cash",
            notes: "Cash",
          });
        }

        await Promise.all(
          cashOutgoingItems.map((item) =>
            axios.delete(`/api/deals/items/${item.id}`),
          ),
        );
      }

      await fetchDealDetails(currentDeal.id);
      setDealNotice(
        `Applied ${neededDelta >= 0 ? "+" : ""}${neededDelta.toFixed(2)} via cash adjustment.`,
      );
    } catch (error) {
      console.error("Failed to apply net cash target:", error);
      setDealNotice("Failed to update net cash.");
    } finally {
      setIsApplyingCash(false);
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

  const handleScanPhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (scanPreviewUrl) {
      URL.revokeObjectURL(scanPreviewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    setScanPreviewUrl(previewUrl);
    setScanPhotoName(file.name);
    setScanCandidates([]);
    setScanStatus(
      "Photo captured. Recognition lookup is a placeholder for now.",
    );
    setDealNotice(
      "Photo captured. Scan lookup and auto-add are coming soon. Use search below for now.",
    );
  };

  const clearScanPhoto = () => {
    if (scanPreviewUrl) {
      URL.revokeObjectURL(scanPreviewUrl);
    }
    setScanPreviewUrl(null);
    setScanPhotoName("");
    setScanCandidates([]);
    setScanStatus("No photo selected. Capture a card photo to begin.");
  };

  const runMockScanLookup = async () => {
    if (!scanPreviewUrl) return;

    const baseName = scanPhotoName
      .replace(/\.[^/.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim();
    const query = baseName.length >= 2 ? baseName : "pikachu";

    setLoadingScanCandidates(true);
    setScanStatus(`Running mock lookup for "${query}"...`);
    try {
      const response = await axios.get("/api/cards/search", {
        params: {
          q: query,
          limit: 8,
          offset: 0,
          sortBy: "dateDesc",
        },
      });
      const cards = (response.data.cards ?? []) as SearchCard[];
      setScanCandidates(cards);
      if (cards.length > 0) {
        setScanStatus(`Mock matches ready (${cards.length}). Pick one to add.`);
      } else {
        setScanStatus("No mock matches found. Try manual search below.");
      }
    } catch (error) {
      console.error("Mock scan lookup failed:", error);
      setScanCandidates([]);
      setScanStatus("Mock lookup failed. Use manual search below.");
    } finally {
      setLoadingScanCandidates(false);
    }
  };

  const addMockCandidateToIncoming = async (card: SearchCard) => {
    await addCardToDeal(card);
    setDealNotice(`Added ${card.data?.name || card.id} from mock scan match.`);
  };

  const netCash = outgoingTotal - incomingTotal;
  let netCashClass = "neutral";
  if (netCash > 0) {
    netCashClass = "positive";
  } else if (netCash < 0) {
    netCashClass = "negative";
  }

  const cashIncomingTotal = (currentDeal?.incoming ?? [])
    .filter((item) => item.itemType === "cash")
    .reduce((sum, item) => sum + toFiniteNumber(item.price) * item.quantity, 0);
  const cashOutgoingTotal = (currentDeal?.outgoing ?? [])
    .filter((item) => item.itemType === "cash")
    .reduce((sum, item) => sum + toFiniteNumber(item.price) * item.quantity, 0);
  const cashAdjustment = cashOutgoingTotal - cashIncomingTotal;

  const baseIncomingTotal = incomingTotal - cashIncomingTotal;
  const baseOutgoingTotal = outgoingTotal - cashOutgoingTotal;
  const baseNetCash = baseOutgoingTotal - baseIncomingTotal;
  const projectedIncomingTotal = Number(
    (baseIncomingTotal * (outgoingTradePercentage / 100)).toFixed(2),
  );
  const projectedBaseNetCash = baseOutgoingTotal - projectedIncomingTotal;
  const projectedNetCash =
    outgoingTotal - (projectedIncomingTotal + cashIncomingTotal);
  const activeBaseNetCash =
    outgoingTradePercentage !== 100 && baseIncomingTotal > 0
      ? projectedBaseNetCash
      : baseNetCash;
  const activeNetCash =
    outgoingTradePercentage !== 100 && baseIncomingTotal > 0
      ? projectedNetCash
      : netCash;

  useEffect(() => {
    if (!currentDeal) {
      setTargetNetCash("0");
      return;
    }
    setTargetNetCash(activeNetCash.toFixed(2));
  }, [activeNetCash, currentDeal?.id]);

  useEffect(() => {
    return () => {
      if (scanPreviewUrl) {
        URL.revokeObjectURL(scanPreviewUrl);
      }
    };
  }, [scanPreviewUrl]);

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
        const itemImage =
          item.card?.data?.images?.small ||
          item.card?.data?.images?.large ||
          "";
        const setName = item.card?.data?.set?.name ?? "";
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
          itemImage,
          setName,
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
          itemImage: string;
          setName: string;
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

  const renderDealItemRow = (
    item: DealItem,
    isCash = false,
    previewPercentage?: number,
  ) => {
    return (
      <div
        key={item.id}
        className={`deal-bucket-row${isCash ? " deal-bucket-row--cash" : ""}`}
      >
        {item.card?.data?.images?.small ? (
          <img
            src={item.card.data.images.small}
            alt={item.card.data.name}
            className="deal-bucket-thumb"
          />
        ) : (
          <div className="deal-bucket-thumb deal-bucket-thumb--empty" />
        )}
        <div className="deal-bucket-info">
          <span className="deal-bucket-name">
            {item.notes ||
              item.card?.data?.name ||
              item.cardId ||
              item.itemType}
            {item.itemType !== "card" && (
              <span className="item-type-badge"> [{item.itemType}]</span>
            )}
            {item.card?.tcgPlayerId && (
              <a
                href={`https://tcgplayer.com/product/${item.card.tcgPlayerId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tcgplayer-link"
                title="View on TCGPlayer"
              >
                🔗
              </a>
            )}
          </span>
          {(item.card?.data?.number || item.card?.data?.set?.name) && (
            <span className="deal-bucket-meta">
              {item.card.data.number && `#${item.card.data.number}`}
              {item.card.data.number && item.card.data.set?.name && " · "}
              {item.card.data.set?.name}
            </span>
          )}
          <span className="deal-bucket-price">
            {item.quantity} × ${toFiniteNumber(item.price).toFixed(2)}
            {previewPercentage != null &&
              previewPercentage !== 100 &&
              !isCash && (
                <span className="deal-price-preview">
                  {" "}
                  → $
                  {(
                    toFiniteNumber(item.price) *
                    item.quantity *
                    (previewPercentage / 100)
                  ).toFixed(2)}
                </span>
              )}
          </span>
        </div>
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
    );
  };

  return (
    <div className="deal-tracker-page">
      <h1>Deal Tracker</h1>

      <div className="deal-controls">
        {!currentDeal && (
          <>
            {/* Draft deals list */}
            <div className="draft-deals-section">
              <div className="draft-deals-header">
                <h2>In-Progress Deals</h2>
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
                  <button type="button" onClick={() => void createNewDeal()}>
                    + New Deal
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLocationForm(!showLocationForm)}
                    className="secondary-btn"
                  >
                    {showLocationForm ? "Cancel" : "+ Add Location"}
                  </button>
                </div>
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

              {loadingDrafts ? (
                <div className="loading">Loading draft deals...</div>
              ) : draftDeals.length === 0 ? (
                <div className="search-status-banner">
                  No in-progress deals. Start a new one above.
                </div>
              ) : (
                <div className="draft-deals-list">
                  {draftDeals.map((draft) => {
                    const netCash = draft.outgoingTotal - draft.incomingTotal;
                    const dateStr = new Date(
                      draft.dateCreated,
                    ).toLocaleDateString();
                    return (
                      <div key={draft.id} className="draft-deal-card">
                        <div className="draft-deal-info">
                          <span className="draft-deal-location">
                            📍 {draft.location || "Unspecified Location"}
                          </span>
                          <span className="draft-deal-meta">
                            Started {dateStr} · {draft.incoming.length} in /{" "}
                            {draft.outgoing.length} out
                          </span>
                          <span className="draft-deal-totals">
                            In: ${draft.incomingTotal.toFixed(2)} · Out: $
                            {draft.outgoingTotal.toFixed(2)} · Net:{" "}
                            {netCash >= 0 ? "+" : ""}${netCash.toFixed(2)}
                          </span>
                        </div>
                        <div className="draft-deal-actions">
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void fetchDealDetails(draft.id)}
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            className="action-btn-delete"
                            onClick={() => void deleteDraftDeal(draft.id)}
                            title="Delete this draft deal"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {dealNotice && <div className="search-status-banner">{dealNotice}</div>}

        {currentDeal && (
          <>
            <div className="deal-active-header">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setCurrentDeal(null);
                  setIncomingTotal(0);
                  setOutgoingTotal(0);
                  setDealNotice(null);
                  void loadDraftDeals();
                }}
              >
                ← Back to Deals
              </button>
              <span className="deal-active-title">
                📍 {currentDeal.location || "Unspecified Location"}
              </span>
            </div>
            <div className="context-panel">
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

              <div className="mobile-scan-panel">
                <div className="context-panel-header">
                  <h3>Scan Card (Camera)</h3>
                  <p className="panel-description">
                    Mobile-first capture flow. Recognition and auto-add are
                    placeholders for now.
                  </p>
                </div>

                <div className="mobile-scan-actions">
                  <label className="btn-secondary mobile-scan-capture-btn">
                    Take Photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="mobile-scan-file-input"
                      onChange={handleScanPhotoSelected}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={clearScanPhoto}
                    disabled={!scanPreviewUrl}
                  >
                    Clear
                  </button>
                </div>

                {scanPreviewUrl && (
                  <div className="mobile-scan-preview-wrap">
                    <img
                      src={scanPreviewUrl}
                      alt="Card scan preview"
                      className="mobile-scan-preview"
                    />
                    <span className="mobile-scan-photo-name">
                      {scanPhotoName}
                    </span>
                  </div>
                )}

                <div className="mobile-scan-result">
                  <span>{scanStatus}</span>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!scanPreviewUrl}
                    onClick={() => void runMockScanLookup()}
                  >
                    {loadingScanCandidates
                      ? "Finding Matches..."
                      : "Find Matches (Mock)"}
                  </button>
                </div>

                {scanCandidates.length > 0 && (
                  <div className="scan-candidates-list">
                    {scanCandidates.map((candidate) => (
                      <div key={candidate.id} className="scan-candidate-card">
                        {candidate.data.images?.small ? (
                          <img
                            src={candidate.data.images.small}
                            alt={candidate.data.name ?? candidate.id}
                            className="scan-candidate-thumb"
                          />
                        ) : (
                          <div className="scan-candidate-thumb scan-candidate-thumb--empty" />
                        )}
                        <div className="scan-candidate-info">
                          <span className="scan-candidate-name">
                            {candidate.data.name ?? candidate.id}
                          </span>
                          <span className="scan-candidate-meta">
                            {candidate.data.number
                              ? `#${candidate.data.number}`
                              : ""}
                            {candidate.data.number && candidate.data.set?.name
                              ? " · "
                              : ""}
                            {candidate.data.set?.name ?? ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            void addMockCandidateToIncoming(candidate)
                          }
                        >
                          Add to Incoming
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <CardSearchPanel title="" onCardSelect={addCardToDeal} />

              <div className="manual-entry-section">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setShowManualIncomingCard(!showManualIncomingCard)
                  }
                >
                  {showManualIncomingCard ? "▲ Cancel" : "+ Add Card Manually"}
                </button>

                {showManualIncomingCard && (
                  <div className="manual-entry-form">
                    <div className="context-form-grid">
                      <label className="field-group field-group-wide">
                        <span>Card Name / Description</span>
                        <input
                          type="text"
                          placeholder="e.g. Charizard EX PSA 8"
                          value={manualCardIncomingName}
                          onChange={(e) =>
                            setManualCardIncomingName(e.target.value)
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Quantity</span>
                        <input
                          type="number"
                          min="1"
                          value={manualCardIncomingQty}
                          onChange={(e) =>
                            setManualCardIncomingQty(e.target.value)
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Price</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualCardIncomingPrice}
                          onChange={(e) =>
                            setManualCardIncomingPrice(e.target.value)
                          }
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      disabled={
                        !manualCardIncomingName.trim() ||
                        isSubmittingManualIncomingCard
                      }
                      onClick={() => void addManualIncomingCard()}
                    >
                      {isSubmittingManualIncomingCard
                        ? "Adding..."
                        : "Add to Incoming"}
                    </button>
                  </div>
                )}
              </div>

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
              <input
                type="text"
                className="search-input"
                value={outgoingSearch}
                onChange={(e) => setOutgoingSearch(e.target.value)}
                placeholder="Search inventory by name, number, or card id"
              />

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
                    <div
                      key={candidate.cardId}
                      className="outgoing-candidate-row"
                    >
                      {candidate.itemImage ? (
                        <img
                          src={candidate.itemImage}
                          alt={candidate.itemName}
                          className="outgoing-candidate-thumb"
                        />
                      ) : (
                        <div className="outgoing-candidate-thumb outgoing-candidate-thumb--empty" />
                      )}
                      <div className="outgoing-candidate-info">
                        <span className="outgoing-candidate-name">
                          {candidate.itemName}
                        </span>
                        <span className="outgoing-candidate-meta">
                          {candidate.itemNumber && `#${candidate.itemNumber}`}
                          {candidate.itemNumber && candidate.setName && " · "}
                          {candidate.setName}
                        </span>
                        <span className="outgoing-candidate-sub">
                          Avail: {candidate.availableQuantity} · $
                          {candidate.suggestedPrice.toFixed(2)}
                        </span>
                      </div>
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
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="manual-entry-section">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setShowManualOutgoingCard(!showManualOutgoingCard)
                  }
                >
                  {showManualOutgoingCard
                    ? "▲ Cancel"
                    : "+ Add Card Manually to Outgoing"}
                </button>

                {showManualOutgoingCard && (
                  <div className="manual-entry-form">
                    <div className="context-form-grid">
                      <label className="field-group field-group-wide">
                        <span>Card Name / Description</span>
                        <input
                          type="text"
                          placeholder="e.g. Blastoise PSA 9"
                          value={manualCardOutgoingName}
                          onChange={(e) =>
                            setManualCardOutgoingName(e.target.value)
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Quantity</span>
                        <input
                          type="number"
                          min="1"
                          value={manualCardOutgoingQty}
                          onChange={(e) =>
                            setManualCardOutgoingQty(e.target.value)
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Price</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualCardOutgoingPrice}
                          onChange={(e) =>
                            setManualCardOutgoingPrice(e.target.value)
                          }
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      disabled={
                        !manualCardOutgoingName.trim() ||
                        isSubmittingManualOutgoingCard
                      }
                      onClick={() => void addManualOutgoingCard()}
                    >
                      {isSubmittingManualOutgoingCard
                        ? "Adding..."
                        : "Add to Outgoing"}
                    </button>
                  </div>
                )}
              </div>

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

            <div className="deal-summary">
              <div className="deal-totals">
                <div className="total-item">
                  <span>Incoming</span>
                  <strong>${incomingTotal.toFixed(2)}</strong>
                </div>
                <div className="total-item">
                  <span>Outgoing</span>
                  <strong>${outgoingTotal.toFixed(2)}</strong>
                </div>
                <div className={`total-item net-cash ${netCashClass}`}>
                  <span>
                    Net Cash
                    {outgoingTradePercentage !== 100 &&
                      baseIncomingTotal > 0 && (
                        <span className="net-cash-before-pct">
                          {" "}
                          (before {outgoingTradePercentage}%:{" "}
                          {netCash >= 0 ? "+" : ""}${netCash.toFixed(2)})
                        </span>
                      )}
                  </span>
                  <strong>
                    {outgoingTradePercentage !== 100 && baseIncomingTotal > 0
                      ? `${activeNetCash >= 0 ? "+" : ""}$${activeNetCash.toFixed(2)}`
                      : `${netCash >= 0 ? "+" : ""}$${netCash.toFixed(2)}`}
                  </strong>
                </div>
              </div>

              <div className="cash-adjustment-controls">
                <div className="cash-adjustment-meta">
                  <span>
                    Base Net (No Cash): ${activeBaseNetCash.toFixed(2)}
                    {outgoingTradePercentage !== 100 &&
                      baseIncomingTotal > 0 && (
                        <span className="net-cash-before-pct">
                          {" "}
                          (before {outgoingTradePercentage}%: $
                          {baseNetCash.toFixed(2)})
                        </span>
                      )}
                  </span>
                  <span>
                    Cash Adjustment: {cashAdjustment >= 0 ? "+" : ""}$
                    {cashAdjustment.toFixed(2)}
                  </span>
                </div>
                <div className="cash-adjustment-form">
                  <label htmlFor="target-net-cash">Set Net Cash</label>
                  <input
                    id="target-net-cash"
                    type="number"
                    step="0.01"
                    value={targetNetCash}
                    onChange={(e) => setTargetNetCash(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void applyNetCashTarget()}
                    disabled={isApplyingCash}
                  >
                    {isApplyingCash ? "Applying..." : "Apply Target"}
                  </button>
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

            <div className="deal-item-columns">
              {(["incoming", "outgoing"] as const).map((col) => (
                <section
                  key={col}
                  className="deal-item-column"
                  aria-label={`${col === "incoming" ? "Incoming" : "Outgoing"} items`}
                >
                  <h3>{col === "incoming" ? "Incoming" : "Outgoing"} Items</h3>
                  {col === "incoming" && (
                    <div className="trade-percentage-section">
                      <div className="trade-percentage-label">
                        Buying at % of market price
                      </div>
                      <div className="trade-percentage-presets">
                        {[75, 80, 85, 100].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            className={`percentage-preset${outgoingTradePercentage === pct ? " active" : ""}`}
                            onClick={() => setOutgoingTradePercentage(pct)}
                            disabled={isApplyingOutgoingPercentage}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                      <div className="trade-percentage-custom">
                        <input
                          type="number"
                          min="1"
                          max="200"
                          value={outgoingTradePercentage}
                          onChange={(e) => {
                            const next = Math.max(
                              1,
                              Math.min(200, Number(e.target.value) || 100),
                            );
                            setOutgoingTradePercentage(next);
                          }}
                          className="percentage-input"
                          disabled={isApplyingOutgoingPercentage}
                        />
                        <span className="percentage-symbol">%</span>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void applyOutgoingPercentage()}
                          disabled={isApplyingOutgoingPercentage}
                        >
                          {isApplyingOutgoingPercentage
                            ? "Applying..."
                            : "Apply % to Offer"}
                        </button>
                      </div>
                      <div className="trade-calculation">
                        Offer at {outgoingTradePercentage}% →{" "}
                        <strong className="trade-price-final">
                          Net {activeNetCash >= 0 ? "+" : ""}$
                          {activeNetCash.toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  )}
                  {currentDeal[col].length === 0 && (
                    <div className="empty-deal-items">No items yet.</div>
                  )}
                  {currentDeal[col]
                    .filter((item) => item.itemType !== "cash")
                    .map((item) =>
                      renderDealItemRow(
                        item,
                        false,
                        col === "incoming"
                          ? outgoingTradePercentage
                          : undefined,
                      ),
                    )}

                  {currentDeal[col].some(
                    (item) => item.itemType === "cash",
                  ) && (
                    <div className="cash-items-group">
                      <div className="cash-items-group-title">
                        Cash Adjustment
                      </div>
                      {currentDeal[col]
                        .filter((item) => item.itemType === "cash")
                        .map((item) => renderDealItemRow(item, true))}
                    </div>
                  )}
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
