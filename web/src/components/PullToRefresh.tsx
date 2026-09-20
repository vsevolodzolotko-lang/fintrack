import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 72;
const hasTouch =
  typeof window !== "undefined" &&
  "ontouchstart" in window &&
  navigator.maxTouchPoints > 0;

export function PullToRefresh({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const drag = useRef({ active: false, startY: 0, y: 0 });

  useEffect(() => {
    if (!hasTouch) return;
    const el = ref.current;
    if (!el) return;

    // Check if page is at the very top, regardless of which element actually scrolls.
    const isAtTop = () => el.scrollTop <= 2 && window.scrollY <= 2;

    const onStart = (e: TouchEvent) => {
      if (!isAtTop()) return;
      drag.current = { active: true, startY: e.touches[0].clientY, y: 0 };
    };

    const onMove = (e: TouchEvent) => {
      if (!drag.current.active) return;
      // If user scrolled down since touchstart, abandon pull.
      if (!isAtTop()) {
        drag.current.active = false;
        setPullY(0);
        return;
      }
      const dy = e.touches[0].clientY - drag.current.startY;
      if (dy > 0) {
        e.preventDefault();
        const y = Math.min(dy * 0.45, THRESHOLD + 24);
        drag.current.y = y;
        setPullY(y);
      } else {
        // Scrolling up (finger moving up) — abandon pull, let browser scroll.
        drag.current.active = false;
        setPullY(0);
      }
    };

    const onEnd = async () => {
      if (!drag.current.active) return;
      const y = drag.current.y;
      drag.current.active = false;

      if (y >= THRESHOLD) {
        setRefreshing(true);
        setPullY(THRESHOLD * 0.6);
        try {
          await qc.invalidateQueries();
          await new Promise((r) => setTimeout(r, 600));
        } finally {
          setRefreshing(false);
          setPullY(0);
        }
      } else {
        setPullY(0);
      }
    };

    // Attach to document so preventDefault reaches the actual scroll source.
    el.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [qc]);

  const triggered = pullY >= THRESHOLD;
  const rotation = Math.min(360, (pullY / THRESHOLD) * 360);

  return (
    <div ref={ref} className="content">
      {hasTouch && (
        <div
          style={{
            height: pullY,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            transition: pullY === 0 ? "height .32s cubic-bezier(.2,.8,.3,1)" : "none",
          }}
        >
          {(pullY > 8 || refreshing) && (
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: triggered
                  ? "rgba(245,166,35,.18)"
                  : "rgba(255,255,255,.07)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background .15s, transform .15s",
                transform: triggered ? "scale(1.1)" : "scale(1)",
              }}
            >
              <RefreshCw
                size={18}
                color={triggered || refreshing ? "#F5A623" : "#6c7185"}
                style={{
                  transform: refreshing
                    ? undefined
                    : `rotate(${rotation}deg)`,
                  animation: refreshing
                    ? "ptr-spin 0.8s linear infinite"
                    : undefined,
                  transition: refreshing
                    ? undefined
                    : "transform .05s linear, color .15s",
                }}
              />
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
