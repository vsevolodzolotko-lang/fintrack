import { useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Home, List, Plus, Settings, TrendingUp } from "lucide-react";
import { useAuth } from "./auth";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import { Settings as SettingsPage } from "./pages/Settings";
import { Login } from "./pages/Login";
import { Review } from "./pages/Review";
import { Investments } from "./pages/Investments";
import { History } from "./pages/History";
import { HistoryCategory } from "./pages/HistoryCategory";

export function App() {
  const { user, loading } = useAuth();
  const [reviewOpen, setReviewOpen] = useState(false);

  if (loading) return <div className="center" style={{ color: "#6c7185", fontSize: 14, fontWeight: 600 }}>Завантаження…</div>;
  if (!user) return <Login />;

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Dashboard onOpenReview={() => setReviewOpen(true)} />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/category/:id" element={<HistoryCategory />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>

      <TabBar onOpenReview={() => setReviewOpen(true)} />

      {reviewOpen && <Review onClose={() => setReviewOpen(false)} />}
    </div>
  );
}

function TabBar({ onOpenReview }: { onOpenReview: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname;

  // Tapping a tab you're already on softly but quickly scrolls the page to the top;
  // otherwise it navigates to that tab.
  const goTab = (path: string) => () => {
    if (tab === path) {
      const el = document.querySelector<HTMLElement>(".content");
      el?.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      navigate(path);
    }
  };

  return (
    <nav className="tabbar">
      <button className={"tab-btn" + (tab === "/" ? " active" : "")} onClick={goTab("/")}>
        <Home size={24} strokeWidth={2} />
        <span>Дашборд</span>
      </button>
      <button className={"tab-btn" + (tab === "/transactions" ? " active" : "")} onClick={goTab("/transactions")}>
        <List size={24} strokeWidth={2} />
        <span>Транзакції</span>
      </button>
      <button className="fab-btn" onClick={onOpenReview}>
        <Plus size={28} stroke="#1a1200" strokeWidth={2.6} />
      </button>
      <button className={"tab-btn" + (tab === "/investments" ? " active" : "")} onClick={goTab("/investments")}>
        <TrendingUp size={24} strokeWidth={2} />
        <span>Інвестиції</span>
      </button>
      <button className={"tab-btn" + (tab === "/settings" ? " active" : "")} onClick={goTab("/settings")}>
        <Settings size={24} strokeWidth={2} />
        <span>Налашт.</span>
      </button>
    </nav>
  );
}
