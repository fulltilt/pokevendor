import { Router, type Request, type Response } from "express";
import axios from "axios";

const router = Router();

const EBAY_FINDING_API =
  "https://svcs.ebay.com/services/search/FindingService/v1";

type EbayLastSoldResult = {
  title: string;
  soldPrice: number;
  soldAt: string;
  condition: string;
  url: string;
};

const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const computeMedian = (prices: number[]): number | null => {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? null);
};

const parseEbayItems = (rawItems: unknown[]): EbayLastSoldResult[] => {
  const results: EbayLastSoldResult[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const title = Array.isArray(r.title) ? String(r.title[0] ?? "") : "";

    const sellingStatus =
      Array.isArray(r.sellingStatus) && r.sellingStatus[0]
        ? (r.sellingStatus[0] as Record<string, unknown>)
        : null;
    const priceArr = sellingStatus?.convertedCurrentPrice;
    const priceEntry =
      Array.isArray(priceArr) && priceArr[0] ? priceArr[0] : null;
    const soldPrice = toFiniteNumber(
      priceEntry && typeof priceEntry === "object"
        ? (priceEntry as Record<string, unknown>).__value__
        : null,
    );
    if (soldPrice === null || soldPrice <= 0) continue;

    const listingInfo =
      Array.isArray(r.listingInfo) && r.listingInfo[0]
        ? (r.listingInfo[0] as Record<string, unknown>)
        : null;
    const endTimeArr = listingInfo?.endTime;
    const soldAt =
      Array.isArray(endTimeArr) && typeof endTimeArr[0] === "string"
        ? endTimeArr[0]
        : "";

    const conditionEntry =
      Array.isArray(r.condition) && r.condition[0]
        ? (r.condition[0] as Record<string, unknown>)
        : null;
    const conditionNameArr = conditionEntry?.conditionDisplayName;
    const condition =
      Array.isArray(conditionNameArr) && typeof conditionNameArr[0] === "string"
        ? conditionNameArr[0]
        : "";

    const urlArr = r.viewItemURL;
    const url =
      Array.isArray(urlArr) && typeof urlArr[0] === "string" ? urlArr[0] : "";

    results.push({ title, soldPrice, soldAt, condition, url });
  }

  return results;
};

// GET /api/ebay/last-sold?q=Pokemon+Booster+Box&limit=5
router.get("/last-sold", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res
      .status(400)
      .json({ error: "Missing required query parameter: q" });
  }

  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "5"), 10) || 5, 1),
    20,
  );

  const appId = process.env.EBAY_APP_ID;
  if (!appId) {
    return res
      .status(503)
      .json({ error: "eBay API not configured (missing EBAY_APP_ID)" });
  }

  try {
    const params = new URLSearchParams({
      "OPERATION-NAME": "findCompletedItems",
      "SERVICE-VERSION": "1.0.0",
      "SECURITY-APPNAME": appId,
      "RESPONSE-DATA-FORMAT": "JSON",
      keywords: q,
      "itemFilter(0).name": "SoldItemsOnly",
      "itemFilter(0).value": "true",
      sortOrder: "EndTimeSoonest",
      "paginationInput.entriesPerPage": String(limit),
    });

    const response = await axios.get(
      `${EBAY_FINDING_API}?${params.toString()}`,
      { timeout: 10_000 },
    );

    const responseRoot = response.data?.findCompletedItemsResponse?.[0] as
      | Record<string, unknown>
      | undefined;

    const ack = Array.isArray(responseRoot?.ack) ? responseRoot?.ack[0] : "";
    if (ack !== "Success" && ack !== "Warning") {
      const errorMsg =
        (
          (
            (responseRoot?.errorMessage as unknown[])?.[0] as
              | Record<string, unknown>
              | undefined
          )?.error as unknown[]
        )?.[0] &&
        typeof (
          (
            (
              (responseRoot?.errorMessage as unknown[])?.[0] as
                | Record<string, unknown>
                | undefined
            )?.error as unknown[]
          )?.[0] as Record<string, unknown>
        )?.message?.[0] === "string"
          ? String(
              (
                (
                  (
                    (responseRoot?.errorMessage as unknown[])?.[0] as
                      | Record<string, unknown>
                      | undefined
                  )?.error as unknown[]
                )?.[0] as Record<string, unknown>
              )?.message?.[0],
            )
          : "eBay API error";
      return res.status(502).json({ error: errorMsg });
    }

    const rawItems: unknown[] =
      ((responseRoot?.searchResult as Record<string, unknown>[])?.[0]
        ?.item as unknown[]) ?? [];

    const results = parseEbayItems(rawItems);
    const prices = results.map((r) => r.soldPrice);
    const median = computeMedian(prices);

    return res.json({
      query: q,
      count: results.length,
      median,
      results,
    });
  } catch (error) {
    console.error("[EBAY] last-sold lookup failed:", error);
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      return res
        .status(403)
        .json({ error: "eBay API access denied. Check your App ID." });
    }
    return res
      .status(502)
      .json({ error: "Failed to fetch eBay last sold data" });
  }
});

export default router;
