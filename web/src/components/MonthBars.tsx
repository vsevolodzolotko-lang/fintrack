import { ymShort } from "../format";

interface Props {
  months: { ym: string; spent: string; partial?: "start" | "running" | null }[];
  limit?: string | null;
  selected: string;
  /** Немає → стовпчики не клікабельні (сторінка категорії лише показує). */
  onSelect?: (ym: string) => void;
}

export function MonthBars({ months, limit, selected, onSelect }: Props) {
  const values = months.map((m) => Number(m.spent));
  const lim = limit != null ? Number(limit) : null;
  // Верх шкали — найбільше з витрат і лінії, щоб лінія завжди була в кадрі.
  // Мінімум 1, щоб не ділити на нуль на порожньому місяці.
  const max = Math.max(1, ...values, lim ?? 0);

  return (
    <div>
      <div className="hist-chart">
        {lim !== null && (
          <div className="hist-limit" style={{ bottom: `${(lim / max) * 100}%` }} />
        )}
        {months.map((m) => {
          const v = Number(m.spent);
          const over = lim !== null && v > lim;
          return (
            <button
              key={m.ym}
              className={
                "hist-bar" +
                (m.ym === selected ? " sel" : "") +
                (over ? " over" : "") +
                (m.partial ? " partial" : "")
              }
              // Від'ємний місяць (повернень більше за витрати) не має від'ємної
              // висоти — показуємо ниткою, інакше стовпчик зник би зовсім.
              style={{
                height: `${Math.max(2, (Math.max(0, v) / max) * 100)}%`,
                cursor: onSelect ? "pointer" : "default",
              }}
              disabled={!onSelect}
              onClick={() => onSelect?.(m.ym)}
              aria-label={ymShort(m.ym)}
            />
          );
        })}
      </div>
      <div className="hist-axis">
        {months.map((m) => <span key={m.ym}>{ymShort(m.ym)}</span>)}
      </div>
    </div>
  );
}
