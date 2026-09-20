import { ChevronRight, Wallet } from "lucide-react";
import { fmtGrn } from "../format";

interface Props {
  leftover: string;   // копійки рядком
  onOpen: () => void;
}

// Раз на місяць, найперший блок дашборда: доки залишок не розподілено,
// бюджети нового циклу рахуються без нього.
export function ClosureCta({ leftover, onOpen }: Props) {
  return (
    <button className="review-cta" style={{ marginTop: 12 }} onClick={onOpen}>
      <div className="review-cta-icon">
        <Wallet size={22} color="#F5A623" strokeWidth={2} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="review-cta-title">Місяць закрито · {fmtGrn(leftover)} залишилось</div>
        <div className="review-cta-sub">Розподілити між цілями, інвестиціями і побутом</div>
      </div>
      <ChevronRight size={20} color="#F5A623" strokeWidth={2.2} />
    </button>
  );
}
