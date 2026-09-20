import { Info, X } from "lucide-react";

// Довідка живе в шиті, а не в поповері. Три причини: поповер position:absolute
// накривав наступний крок чеклісту, довгий текст доводилось читати тримаючи
// палець, і в апці було два різні патерни довідки — 30px тут і 38px у REIT.
// Шит модальний, тож «одна відкрита за раз» виходить сама собою.

export function HelpButton({ label, onClick }: { label?: string; onClick: () => void }) {
  return (
    <button className="help-btn" aria-label={label ?? "Що це і як користуватись"} onClick={onClick}>
      <Info size={15} color="#8a90a2" strokeWidth={2.2} />
    </button>
  );
}

export function HelpSheet({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="amt-backdrop" onClick={onClose} />
      <div className="amt-sheet">
        <div className="amt-grip" />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div className="amt-title" style={{ flex: 1 }}>{title}</div>
          <button className="review-close" onClick={onClose} aria-label="Закрити">
            <X size={18} color="#EDEFF5" strokeWidth={2.2} />
          </button>
        </div>
        <div className="help-sheet-body">{children}</div>
      </div>
    </>
  );
}
