import { useState } from "react";
import "./App.css";
import { InventoryPage } from "./pages/InventoryPage";
import { DealTrackerPage } from "./pages/DealTrackerPage";
import { DealHistoryPage } from "./pages/DealHistoryPage";

type Page = "inventory" | "deals" | "history";

export const App = () => {
  const [currentPage, setCurrentPage] = useState<Page>("inventory");

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-title">PokeVendor</div>
        <div className="nav-links">
          <button
            type="button"
            className={`nav-btn ${currentPage === "inventory" ? "active" : ""}`}
            onClick={() => setCurrentPage("inventory")}
          >
            Inventory
          </button>
          <button
            type="button"
            className={`nav-btn ${currentPage === "deals" ? "active" : ""}`}
            onClick={() => setCurrentPage("deals")}
          >
            Deal Tracker
          </button>
          <button
            type="button"
            className={`nav-btn ${currentPage === "history" ? "active" : ""}`}
            onClick={() => setCurrentPage("history")}
          >
            Deal History
          </button>
        </div>
      </nav>

      <main className="main-content">
        {currentPage === "inventory" && <InventoryPage />}
        {currentPage === "deals" && <DealTrackerPage />}
        {currentPage === "history" && <DealHistoryPage />}
      </main>
    </div>
  );
};

export default App;
