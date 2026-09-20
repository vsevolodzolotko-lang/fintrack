// Конвертація без привʼязки до поповнення: деталі й дві дії. До цього шита такий
// рядок був глухим кутом — найтривожніше на екрані й єдине, з чим не можна було
// нічого зробити (знахідка 28).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CryptoCandidateOrder, type CryptoConversionRow } from "../../api";
import { fmtGrn } from "../../format";
import { fmtQty } from "./fmtQty";

const KYIV_FULL = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv",
});

export function ConversionSheet({ conversion, onClose, canMarkOutOfTracking }: {
  conversion: CryptoConversionRow;
  onClose: () => void;
  // Пул USDT справді дефіцитний (p.totals.flags.untrackedUsdtSource) — лише
  // тоді позначка щось пояснює. Коли дефіциту немає, позначати нічого не
  // треба: інакше вона роздме пул фантомними USDT (див. фінальний огляд, п.1).
  canMarkOutOfTracking: boolean;
}) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: candidates } = useQuery({
    queryKey: ["crypto-candidates", conversion.id],
    queryFn: () => api.get<CryptoCandidateOrder[]>(`/binance/conversions/${conversion.id}/candidates`),
    enabled: picking,
  });

  const patch = useMutation({
    mutationFn: (body: { p2pOrderId?: string | null; outOfTracking?: boolean }) =>
      api.patch(`/binance/conversions/${conversion.id}`, body),
    // Стара помилка не мусить висіти, коли пробуємо іншу дію — гасимо перед
    // кожним запитом, а не тільки на кнопці «Привʼязати».
    onMutate: () => setError(null),
    onSuccess: () => {
      // Три ключі: тоталси, графік і інвест-історія (GET /investments/history
      // теж рахує cryptoGainUah через computePortfolio) рухаються разом.
      qc.invalidateQueries({ queryKey: ["crypto-portfolio"] });
      qc.invalidateQueries({ queryKey: ["crypto-series"] });
      qc.invalidateQueries({ queryKey: ["invest-history"] });
      onClose();
    },
    onError: () => setError("Не вдалося зберегти. Спробуй ще раз."),
  });

  return (
    <>
      <div className="amt-backdrop" onClick={onClose} />
      <div className="flow-sheet">
        <div className="amt-grip" />
        <div className="flow-title">{picking ? "З якого поповнення ці USDT" : "Обмін без привʼязки"}</div>

        {picking ? (
          <>
            {/* До десяти кандидатів + заголовок + рядок виходу перевищують екран
                (знахідка 3 фінального огляду) — скрол тут, а не на всьому шиті,
                щоб «Назад»/«Закрити» лишались завжди в межах видимого. */}
            <div className="orph-cand-scroll">
              {candidates === undefined ? (
                <div className="orph-why">Шукаємо поповнення…</div>
              ) : candidates.length === 0 ? (
                <div className="orph-why">
                  Немає поповнення з вільним залишком, не пізнішого за цей обмін. Тоді ці USDT
                  куплені поза вікном історії — познач це нижче.
                </div>
              ) : (
                candidates.map((o) => {
                  // Кандидат лишається в списку навіть коли вільного залишку менше,
                  // ніж треба цьому обміну (часткове покриття буває правдою) — але
                  // підпис мусить це сказати, а не мовчати (рішення власника, п.4).
                  const insufficient = Number(o.remainingQty) < Number(conversion.fromAmount);
                  return (
                    <button
                      key={o.id}
                      className="orph-cand"
                      disabled={patch.isPending}
                      onClick={() => patch.mutate({ p2pOrderId: o.id })}
                    >
                      <span className="orph-cand-main">
                        <span className="orph-cand-when">{KYIV_FULL.format(new Date(o.tradeTime))}</span>
                        <span className="orph-cand-sub">
                          куплено {fmtQty(o.assetQty)} USDT за {fmtGrn(o.fiatAmountUah)} · вільно {fmtQty(o.remainingQty)}
                          {insufficient && " — менше, ніж потрібно"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flow-exit">
              <button className="flow-close" onClick={() => setPicking(false)}>Назад</button>
            </div>
          </>
        ) : (
          <>
            <div className="orph-detail"><span>Коли</span><span>{KYIV_FULL.format(new Date(conversion.tradeTime))}</span></div>
            <div className="orph-detail"><span>Віддано</span><span>{fmtQty(conversion.fromAmount)} USDT</span></div>
            <div className="orph-detail"><span>Отримано</span><span>{fmtQty(conversion.toAmount)} {conversion.toAsset}</span></div>
            {conversion.feeUsdt && (
              <div className="orph-detail"><span>Комісія</span><span>{fmtQty(conversion.feeUsdt)} USDT</span></div>
            )}

            {conversion.outOfTracking ? (
              <>
                <div className="orph-why orph-why-lead">
                  Позначено як куплене поза вікном історії: монети в портфелі, а витрата USDT
                  не тягне пул.
                </div>
                <button
                  className="orph-act orph-act-ghost"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ outOfTracking: false })}
                >
                  Знʼяти позначку
                </button>
              </>
            ) : (
              <>
                <button
                  className="orph-act orph-act-primary"
                  onClick={() => { setError(null); setPicking(true); }}
                >
                  Привʼязати до поповнення
                </button>
                {canMarkOutOfTracking ? (
                  <>
                    <button
                      className="orph-act orph-act-ghost"
                      disabled={patch.isPending}
                      onClick={() => patch.mutate({ outOfTracking: true })}
                    >
                      Це поза трекінгом
                    </button>
                    <div className="orph-why">
                      Позначка каже: USDT для цього обміну куплені до того, як синк почав бачити
                      історію. Монети лишаються в портфелі, витрата більше не тягне пул.
                    </div>
                  </>
                ) : (
                  <div className="orph-why">
                    Затрекованих поповнень достатньо, щоб пояснити всі обміни — позначати тут
                    нічого не треба.
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error && <div className="amt-error">{error}</div>}

        <div className="flow-exit">
          <button className="flow-close" onClick={onClose}>Закрити</button>
        </div>
      </div>
    </>
  );
}
