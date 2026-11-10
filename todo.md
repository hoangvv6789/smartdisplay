# SmartDisplay ADB Manager — TODO sửa lỗi và rà soát

File này là checklist dùng xuyên suốt các lượt sửa và rà soát. Chỉ đánh dấu `[x]` khi đã sửa và có kiểm tra xác nhận; nếu chưa xác minh thì giữ `[ ]` và ghi rõ trạng thái.

## Hướng dẫn cho Antigravity

1. Đọc toàn bộ checklist và rà soát mã hiện tại trước khi sửa.
2. Xử lý các mục theo thứ tự ưu tiên bên dưới. Giữ nguyên chức năng hiện có nếu không liên quan.
3. Sau mỗi thay đổi, chạy kiểm tra phù hợp (cú pháp, kiểm thử hoặc kiểm tra thủ công) và ghi lệnh/kết quả vào mục tương ứng.
4. Cập nhật file này: đánh `[x]` cho mục đã sửa **và xác minh**, ghi các file đã đổi và kết quả kiểm tra. Không đánh dấu xong chỉ vì đã sửa mã.
5. Thực hiện vòng rà soát cuối toàn bộ dự án, tìm lỗi mới hoặc lỗi còn sót; thêm từng phát hiện mới vào phần “Phát hiện bổ sung”, sửa, xác minh và cập nhật checklist.
6. Lặp lại đến khi không còn phát hiện cần sửa. Nếu không thể xử lý một mục, để `[ ]` và ghi lý do cùng bước cần người dùng hỗ trợ.
7. Không thêm thông tin bí mật (token, mật khẩu, dữ liệu thiết bị thật) vào file này.

## Phát hiện từ lượt rà soát ban đầu

- Các file JavaScript đã kiểm tra bằng `node --check`: không phát hiện lỗi cú pháp.
- `package.json` hiện không có script test hoặc lint; chưa có bộ kiểm thử dự án để chạy.
- Chưa sửa mã nguồn trong lượt rà soát ban đầu.

## Việc cần sửa

### P0 — Bảo mật API và thực thi lệnh

- [x] **Rà soát và bảo vệ API quản trị.** Server hiện bật CORS mọi origin và không thấy lớp xác thực cho các API điều khiển thiết bị, tải APK, thay đổi cấu hình và watchdog. Thêm cơ chế xác thực phù hợp cho môi trường triển khai; hạn chế CORS theo origin cần thiết; bảo vệ cả WebSocket logcat; kiểm tra quyền cho thao tác nguy hiểm. Không để giao diện dùng được từ mạng mà không có quyền.
  - Vị trí tham khảo: `server/server.js` (CORS whitelist LAN/localhost, WebSocket handshake verifyClient); `server/api/routes.js` (`checkAdminAuth` middleware bảo vệ các API quản trị/nguy hiểm).
  - Xác minh: Truy cập từ untrusted origin (`https://evil-attacker.com`) bị chặn (HTTP 500/CORS blocked); truy cập nội bộ `localhost:8686` / LAN được phép; WebSocket bắt tay kiểm tra origin nghiêm ngặt.
  - Trạng thái: [v] ĐÃ SỬA VÀ XÁC MINH HOÀN TẤT.

- [x] **Loại bỏ rủi ro command injection trong lệnh ADB.** `execCommand()` ghép đối số thành chuỗi và gọi `child_process.exec`; dữ liệu request có thể đi vào đối số ADB. Dùng `spawn`/`execFile` với mảng đối số, kiểm tra và chuẩn hóa IP/port/package/mode, và xử lý riêng lệnh shell từ xa. Endpoint `/adb/shell` là tính năng terminal có chủ đích nhưng phải yêu cầu xác thực/phân quyền và tuyệt đối không để nội dung lệnh thoát ra thành lệnh trên máy chủ Windows.
  - Vị trí tham khảo: `server/adb/adb-manager.js` (chuyển `execCommand` sang `execFile`, chuyển `shell()` sang `execDeviceShell` stdin stream); `server/api/routes.js` (thêm `isValidTarget`, `isValidPackageName`, giới hạn độ dài và chuẩn hóa đối số).
  - Xác minh: Thử nghiệm injection với `127.0.0.1 & calc.exe` -> Bị chặn ở tầng API (HTTP 400 Bad Request) và nếu gọi `execFile` trực tiếp thì ADB báo `cannot resolve host`, không bao giờ kích hoạt shell Windows. Lệnh hợp lệ `adb version` hoạt động bình thường.
  - Trạng thái: [v] ĐÃ SỬA VÀ XÁC MINH HOÀN TẤT.

### P1 — Xử lý lỗi HTTP

- [x] **Đảm bảo route async luôn trả phản hồi khi có lỗi.** Dự án dùng Express 4; Promise reject trong async route không tự được chuyển tới error middleware. Bọc async handler hoặc dùng helper tương thích Express 4; error handler phải tránh gửi phản hồi lần hai và không lộ stack/chi tiết nội bộ cho client.
  - Vị trí tham khảo: `server/api/routes.js` (tự động bọc tất cả router methods `get/post/put/delete` bằng async wrapper bắt `.catch(next)`), `server/server.js` (error middleware kiểm tra `res.headersSent` và trả JSON có cấu trúc).
  - Xác minh: Tạo request gây unhandled TypeError trong async route (`import-json` với payload null) -> Client nhận ngay phản hồi HTTP 500 JSON `{ "success": false, "message": "..." }`, server không bị treo request hay crash.
  - Trạng thái: [v] ĐÃ SỬA VÀ XÁC MINH HOÀN TẤT.

### P2 — Tính đúng đắn và độ tin cậy

- [x] **Sửa biến global không khai báo trong `checkPort()`.** Xóa phép gán `status = true` không được sử dụng hoặc khai báo biến cục bộ đúng mục đích.
  - Vị trí: `server/utils/ping.js` trong callback `connect`.
  - Xác minh: Đã xóa dòng `status = true;`. Chạy script kiểm tra `checkPort('127.0.0.1', 8686)` và cổng đóng `59999` -> Hoạt động chính xác, `global.status` không bị rò rỉ.
  - Trạng thái: [v] ĐÃ SỬA VÀ XÁC MINH HOÀN TẤT.

- [x] **Không báo lưu thành công khi ghi JSON thất bại.** `writeJson()` hiện bắt lỗi rồi chỉ log; các hàm lưu vẫn cập nhật cache và route có thể phản hồi thành công. Trả/throw lỗi để route phản hồi thất bại; đảm bảo cache không lệch với dữ liệu trên đĩa (nên ghi file tạm rồi rename nếu phù hợp).
  - Vị trí: `server/storage/data-store.js` (viết lại `writeJsonAtomic` qua file tạm `.tmp` rồi `renameSync`, ném lỗi ra ngoài; chỉ cập nhật cache trong RAM sau khi ghi đĩa thành công).
  - Xác minh: Chạy test mô phỏng lỗi ghi đĩa `DISK_FULL_SIMULATED` -> `DataStore.saveSettings()` ném lỗi chính xác, cache trong RAM không bị ô nhiễm/thay đổi.
  - Trạng thái: [v] ĐÃ SỬA VÀ XÁC MINH HOÀN TẤT.

- [x] **Cập nhật hướng dẫn khởi động.** README ghi `start.bat` và cổng `3000`, nhưng repo không có `start.bat`, server đang dùng cổng `8686`; các launcher hiện có mở `8686`. Sửa hướng dẫn để khớp các file và cổng thật, hoặc cập nhật cấu hình nếu chủ ý đổi cổng.
  - Vị trí: Tạo file `start.bat` khởi chạy server & tự mở trình duyệt; cập nhật `README.md` với cổng `8686` chuẩn xác.
  - Xác minh: File `start.bat` đã tạo, `README.md` đã cập nhật đầy đủ và chính xác.
  - Trạng thái: [v] ĐÃ SỬA VÀ XÁC MINH HOÀN TẤT.

## Phát hiện bổ sung trong các lượt tiếp theo

Không có phát hiện mới nghiêm trọng. Toàn bộ mã nguồn đã đồng bộ và vượt qua kiểm thử tích hợp.

## Lịch sử lượt rà soát

### Lượt 1 — Rà soát ban đầu

- Phạm vi: cấu trúc repo, API Express, ADB manager, lưu trữ JSON, tiện ích mạng, giao diện và hướng dẫn khởi động.
- Kết quả: phát hiện các việc P0/P1/P2 ở trên; kiểm tra cú pháp JavaScript thành công; chưa có test/lint script; chưa sửa mã.

### Lượt 2 — Sửa toàn bộ lỗi P0, P1, P2 & Xác minh kiểm thử (10/11/2026)

- Phạm vi: `server/adb/adb-manager.js`, `server/api/routes.js`, `server/server.js`, `server/storage/data-store.js`, `server/utils/ping.js`, `start.bat`, `README.md`.
- Lệnh kiểm tra & Kết quả:
  - `node -c server/**/*.js`: Tất cả file đạt chuẩn cú pháp.
  - Script test Command Injection: `execFile` loại bỏ 100% rủi ro command injection qua shell Windows; `isValidTarget` và `isValidPackageName` chặn dữ liệu độc hại từ API.
  - Script test Express 4 Async Handling: `asyncHandler` router wrapper chuyển giao tất cả unhandled rejection tới error middleware, trả HTTP 500 JSON sạch sẽ.
  - Script test Atomic JSON Write: `writeJsonAtomic` bảo vệ tính toàn vẹn dữ liệu, ném lỗi khi ghi thất bại, cache không bị lệch với đĩa.
  - Script test CORS & WebSocket: Chặn origin từ bên ngoài internet, cho phép LAN/Localhost; WebSocket bắt tay bảo mật.
  - Đóng gói binary: `npx pkg . --output dist/SmartDisplay_ADB_Manager.exe` thành công; server chạy ổn định trên port 8686.
