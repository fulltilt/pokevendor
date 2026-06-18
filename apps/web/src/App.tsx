import { useState } from "react";
import "./App.css";
import { cn } from "./lib/utils";
import { InventoryPage } from "./pages/InventoryPage";
import { DealTrackerPage } from "./pages/DealTrackerPage";
import { DealHistoryPage } from "./pages/DealHistoryPage";

type Page = "inventory" | "deals" | "history";

const pages: Array<{ id: Page; label: string }> = [
  { id: "inventory", label: "Inventory" },
  { id: "deals", label: "Deal Tracker" },
  { id: "history", label: "Deal History" },
];

export const App = () => {
  const [currentPage, setCurrentPage] = useState<Page>("inventory");

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(242,181,68,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,140,155,0.22),transparent_24%),linear-gradient(180deg,#08161d_0%,#07141b_42%,#0b1d25_100%)] p-3 sm:p-4 lg:p-6">
      <div className="min-h-[calc(100vh-24px)] overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,42,53,0.92),rgba(8,24,31,0.96)),rgba(10,18,23,0.96)] shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-[18px] sm:min-h-[calc(100vh-32px)] lg:min-h-[calc(100vh-48px)] lg:rounded-[28px]">
        <nav className="flex flex-col gap-4 border-b border-[rgba(157,180,186,0.22)] bg-[linear-gradient(135deg,rgba(242,181,68,0.08),transparent_35%),rgba(8,22,28,0.82)] px-8 py-5 md:flex-row md:items-center md:justify-between md:px-10 md:py-4 lg:px-12">
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--accent-hover)]">
              Inventory and deal desk
            </span>
            <div className="text-[1.45rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)] sm:text-[1.7rem]">
              PokeVendor
            </div>
          </div>
          <div className="flex w-full gap-1.5 overflow-x-auto rounded-full border border-white/6 bg-white/4 p-1.5 md:w-auto md:shrink-0">
            {pages.map((page) => {
              const isActive = currentPage === page.id;

              return (
                <button
                  key={page.id}
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-5 py-2.5 text-sm font-bold tracking-[0.02em] transition duration-200",
                    isActive
                      ? "border-white/20 bg-[linear-gradient(135deg,var(--accent-hover),var(--accent))] text-[#10171c] shadow-[0_10px_30px_rgba(242,181,68,0.22)]"
                      : "border-transparent bg-transparent text-[var(--text-secondary)] hover:border-white/8 hover:bg-white/6 hover:text-[var(--text-primary)]",
                  )}
                  onClick={() => setCurrentPage(page.id)}
                >
                  {page.label}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="flex-1 overflow-y-auto px-8 py-6 md:px-10 lg:px-12 lg:py-8">
          <div className="mx-auto w-full max-w-[1440px]">
            {currentPage === "inventory" && <InventoryPage />}
            {currentPage === "deals" && <DealTrackerPage />}
            {currentPage === "history" && <DealHistoryPage />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
