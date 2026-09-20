import { registerSW } from "virtual:pwa-register";

// Авто-оновлення PWA.
//
// У vite.config.ts стоять skipWaiting + clientsClaim, тож новий service worker
// після деплою активується й перехоплює контроль щойно його знайдено. Але
// авто-згенерована реєстрація ніколи не перезавантажує сторінку — на iOS PWA
// може нескінченно віддавати старий закешований білд. Тут ми:
//   (a) періодично перевіряємо оновлення (Safari сам майже не перевіряє), і
//   (b) один раз перезавантажуємо сторінку, коли новий worker бере контроль —
// щоб кожен деплой доходив до користувача без ручного скидання кешу.

if ("serviceWorker" in navigator) {
  // Перезавантажуємо лише на ОНОВЛЕННЯ (контролер уже був), а не на першу
  // інсталяцію — інакше отримали б зайвий релоад при першому візиті.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = () => {
      registration.update().catch(() => {});
    };
    // Safari/iOS майже не перевіряють самі — опитуємо періодично і коли вкладка
    // знову стає видимою.
    setInterval(check, 60_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  },
});
