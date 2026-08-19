# Bridge Protocol

Контракт между `apps/desktop` и `apps/figma-plugin`. Реализация — `packages/bridge-protocol`
(транспорт-агностичные Zod-схемы + типы), используется **обеими** сторонами
как единственный источник истины о форме сообщений. Ничего из этого пакета не
импортирует ни Electron, ни Figma Plugin API.

## Кто сервер, кто клиент

**Desktop app — WebSocket-сервер** на `127.0.0.1:52847` (фиксированный дефолтный
порт; см. "Порт" ниже). **Figma Plugin UI (iframe)** — клиент. Обоснование — в
`architecture.md`, п.4.

## Envelope

Каждое сообщение — JSON-объект с общим конвертом:

```ts
interface Envelope<K extends string, P> {
  protocolVersion: 1
  id: string           // уникальный id сообщения (nanoid)
  kind: K
  payload: P
  /** Только у сообщений-ответов: id запроса, на который отвечаем. */
  requestId?: string
}
```

`protocolVersion` проверяется на входе до всего остального: несовпадение
версии — это `error` с кодом `PROTOCOL_VERSION_MISMATCH`, соединение не рвётся
(чтобы UI мог показать внятное "обновите приложение/плагин"), но остальные
сообщения от этого пира игнорируются.

## Виды сообщений (`BridgeMessage`)

```ts
type BridgeMessage =
  | HelloMessage           // client → server, начало handshake
  | HelloAckMessage         // server → client, handshake принят
  | HelloRejectMessage       // server → client, handshake отклонён (авторизация/версия)
  | PingMessage               // любое направление, keepalive
  | PongMessage
  | GetSelectionMessage         // client → server (плагин просит текущий выбранный DOM-элемент)
  | ImportNodeMessage             // server → client, DesignDocument для создания Frame/Component
  | ImportAssetMessage              // server → client, один asset (ref-transport, см. asset-model.md)
  | ImportAssetsMessage               // server → client, батч assets ("Import all")
  | ApplyStylesMessage                  // server → client, применить стили к текущему выбору Figma
  | ResponseMessage                       // ack успешного выполнения запроса
  | ErrorMessage                            // структурированная ошибка вместо ResponseMessage
```

Phase 1 реализует и реально гоняет по сети: `Hello*`, `Ping`/`Pong`,
`Response`/`Error`. Остальные (`ImportNode`, `ImportAsset(s)`, `ApplyStyles`,
`GetSelection`) объявлены как типы/Zod-схемы уже сейчас (контракт зафиксирован
для Phase 5-10), но продюсеров/обработчиков для них ещё нет — будут добавлены
вертикальными срезами вместе с conversion-engine/asset-engine.

## Handshake

```
plugin UI                          desktop (ws server)
    │──── connect ws://127.0.0.1:52847 ───────▶│
    │──── HelloMessage{token, client:'figma-plugin', clientVersion} ──▶│
    │                                            │ проверяет token
    │◀─── HelloAckMessage{sessionId, serverVersion} ── (ok)
    │        или
    │◀─── HelloRejectMessage{reason: 'AUTH_FAILED'|'VERSION_UNSUPPORTED'} ── (ошибка, соединение закрывается)
```

`HelloMessage.payload`:
```ts
{ token: string; client: 'figma-plugin'; clientVersion: string }
```

Сервер не отвечает ни на что до получения валидного `Hello` — это единственное
сообщение, разрешённое до аутентификации.

## Session token / handshake secret

Требование "без security theater, но не открытый API" решено так:

1. Сервер слушает **только `127.0.0.1`** (не `0.0.0.0`) — соединение снаружи
   машины невозможно на уровне TCP.
2. При первом запуске desktop-приложение генерирует случайный `pairingToken`
   (`nanoid(24)`) и сохраняет его в `app.getPath('userData')/bridge.json`
   вместе с портом. Токен переживает перезапуски (не нужно перепаривать
   плагин на каждый старт приложения).
3. Токен показывается в UI desktop-приложения (Bridge popover в toolbar) как
   короткий код с кнопкой "Скопировать".
4. Пользователь один раз вставляет код в UI Figma Plugin. Плагин сохраняет
   его через `figma.clientStorage` (персистентно на этой машине/профиле,
   недоступно другим плагинам) и переиспользует при последующих подключениях
   без повторного ввода.
5. Сервер сравнивает присланный `token` с тем, что хранит сам — несовпадение
   → `HelloRejectMessage{reason:'AUTH_FAILED'}` + закрытие сокета.

Это не защищает от локального administrator-уровня атакующего (нерелевантная
модель угроз для localhost dev-инструмента), но исключает "любая открытая в
браузере вкладка тихо подключается к нашему WebSocket и шлёт команды" — реальный
риск для сервера на `127.0.0.1`, у которого иначе нет вообще никакой проверки,
кто на другом конце.

## Порт

Дефолт: `52847`. Если занят — сервер пробует ещё 9 портов подряд
(`52848`…`52856`) и сохраняет реально выбранный порт в `bridge.json` и в UI.
Плагин по умолчанию подключается к `52847`; если desktop ушёл на другой порт
(редкий случай конфликта), UI плагина позволяет ввести порт вручную — без
авто-discovery в Phase 1 (не обосновано сложностью ради редкого edge case;
см. `architecture.md` §6 про технические риски, где это можно пересмотреть,
если станет реальной проблемой).

## Ping/Pong и reconnect

- Сервер шлёт `PingMessage` каждые 15с активному соединению; если `PongMessage`
  не пришёл за 5с — соединение считается мёртвым и разрывается (обнаружение
  зависших TCP-соединений, типично для laptop sleep/wake).
- Клиент (плагин) переподключается с экспоненциальным backoff: `1s → 2s → 4s →
  8s → 16s`, потолок `16s`, без ограничения числа попыток (desktop может быть
  запущен позже плагина — это нормальный, а не ошибочный сценарий).
- Оба UI (`desktop` toolbar, `figma-plugin` панель) отражают текущее состояние:
  `disconnected | connecting | connected`.

## Request/response корреляция

Любое сообщение-запрос (`ImportNodeMessage`, `ApplyStylesMessage`, ...) получает
`id`. Обработавшая сторона отвечает `ResponseMessage{requestId: id, ...}` или
`ErrorMessage{requestId: id, code, message}` — отправитель сопоставляет ответ
по `requestId`, ждёт с таймаутом (по умолчанию 10с на операцию без
конкретики; операции, которые могут быть значимо дольше — `ImportAssetsMessage`
с большим батчем — получат свой таймаут при реализации в Phase 9).

Запросы бывают в обе стороны: `BridgeClient.request()` (плагин → desktop,
Phase 1) и симметричный `BridgeServer.request()` (desktop → плагин, добавлен
в Phase 6 для `ImportNodeMessage` по клику "Import as Frame" — до этого у
сервера была только возможность отвечать на запросы плагина, не инициировать
свои с ожиданием ответа). Оба метода на своей стороне корреляции ничего не
знают друг о друге — просто зеркальная реализация одного и того же паттерна
конверта.

## Сериализация ошибок

```ts
interface ErrorMessage {
  protocolVersion: 1
  id: string
  kind: 'error'
  requestId?: string
  payload: {
    code: string          // напр. 'AUTH_FAILED', 'PROTOCOL_VERSION_MISMATCH', 'FIGMA_API_ERROR', 'VALIDATION_FAILED'
    message: string        // human-readable, безопасно показывать в UI
    details?: unknown        // необязательные структурированные данные (напр. Zod issues)
  }
}
```

Ни при каких обстоятельствах в `ErrorMessage.payload.message` не попадает
сырой stack trace — только описание. Технические детали (если нужны для
отладки) — в `details`, не показываются пользователю напрямую.

## Валидация

Каждое входящее сообщение проходит `BridgeMessageSchema.safeParse` (Zod) до
диспетчеризации по `kind`. Невалидная форма → `ErrorMessage{code:
'VALIDATION_FAILED'}`, соединение не рвётся (в отличие от auth/version
ошибок) — единичное кривое сообщение не должно рвать рабочую сессию.
