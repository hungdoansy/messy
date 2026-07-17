# Mosx

<p align="center">
  <img src="icon.png" width="64" height="64" alt="Mosx" />
</p>

Ứng dụng quản lý Messenger đa tài khoản (Multi-Account) cho macOS — xây dựng trên Electron + Chromium.

---

## Tính năng

- **Đa tài khoản** — Đăng nhập và sử dụng nhiều tài khoản Messenger cùng lúc, chuyển đổi 1 click qua Sidebar.
- **Cô lập dữ liệu** — Mỗi tài khoản chạy trên Session riêng biệt (Cookies, Cache, LocalStorage tách biệt hoàn toàn).
- **Bảo mật** — Chặn "Đã xem" (Read Receipts) và "Đang nhập" (Typing Indicator).
- **Thông báo & Badge** — Nhận thông báo và số tin nhắn chưa đọc cho từng tài khoản.
- **Auto-Fetch Avatar** — Tự động lấy ảnh đại diện từ Messenger.
- **Khóa ứng dụng (PIN)** — Bảo vệ ứng dụng bằng mã PIN.
- **Dark/Light mode** — Hỗ trợ chuyển đổi giao diện.

## Yêu cầu

- [Node.js](https://nodejs.org/) v24+
- [pnpm](https://pnpm.io/) v9.15+

## Cài đặt & Chạy

```bash
pnpm install
pnpm start
```

## Build (macOS — Apple Silicon)

Build nhắm tới macOS **arm64** (chip Apple M).

```bash
pnpm run build      # tạo file .dmg trong dist/
```

File thành phẩm: `dist/Mosx-<version>-arm64.dmg`.

### Ký & công chứng (Code Signing & Notarization)

Để phân phối ra ngoài máy dev cần tài khoản Apple Developer:

- Cài chứng chỉ **Developer ID Application** vào Keychain.
- Đặt `notarize: true` trong `package.json` (mục `build.mac`) và cung cấp
  thông tin qua biến môi trường (App Store Connect API key):
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- Không có chứng chỉ, build vẫn chạy cục bộ (ad-hoc signing) — đặt
  `CSC_IDENTITY_AUTO_DISCOVERY=false` — nhưng **không** thể phân phối hay
  tự động cập nhật. Auto-update chỉ áp dụng cho bản build đã ký hợp lệ.

Ứng dụng bật **hardened runtime** với entitlements ở
`build/entitlements.mac.plist` và siết các Electron fuses trong
`package.json` (`electronFuses`).

> **Lưu ý (Apple Silicon):** việc siết Electron fuses sẽ **sửa đổi** binary
> `Electron Framework`, làm **vô hiệu chữ ký** có sẵn. Trên chip Apple M +
> hardened runtime, chạy binary có chữ ký không khớp sẽ bị macOS kill ngay
> (`EXC_BAD_ACCESS / Code Signature Invalid`). Vì vậy fuse
> `resetAdHocDarwinSignature: true` được bật để **ký lại ad-hoc ngay sau khi
> flip fuses**, giúp bản build không ký (dev) vẫn chạy được. Khi ký bằng
> Developer ID thật, electron-builder sẽ ký đè lên chữ ký ad-hoc này.

## Cấu trúc dự án

| File               | Chức năng                                             |
| ------------------ | ----------------------------------------------------- |
| `main.js`          | Quản lý vòng đời App, Partitions, WebContentsView, IPC. |
| `renderer.js`      | Logic Sidebar đa tài khoản, Modal UI.                 |
| `index.html`       | Sidebar trái (nick) & Sidebar phải (công cụ) & Modal. |
| `preload.js`       | Cầu nối bảo mật giữa DOM và Backend.                  |
| `custom_style.css` | Giao diện Dark Glass và ẩn quảng cáo Facebook.        |

## License

MIT
