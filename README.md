# SmartDisplay ADB Manager (Bệnh viện Đa khoa Hồng Ngọc)

Hệ thống quản lý và điều khiển ADB tập trung dành cho các thiết bị Smart Display tại Bệnh viện Hồng Ngọc.

## 🚀 Các Tính Năng Nổi Bật

1. **Đồng bộ danh sách thiết bị**:
   - Đăng nhập và lấy toàn bộ danh sách thiết bị từ hệ thống Cloud: `http://smart-display.hongngochospital.vn` (qua API `http://api-smart-display.hongngochospital.vn/`).
   - Tự động nhận diện các thiết bị Android đang kết nối ADB.
   - Thêm / Sửa / Xóa thiết bị thủ công.

2. **Tìm kiếm & Bộ lọc nhanh**:
   - Tìm kiếm tức thời theo Tên, Địa chỉ IP, MAC, Phòng ban / Nhóm.
   - Quét trạng thái mạng LAN (Ping) và kiểm tra cổng ADB 5555.

3. **Kết nối ADB 1-Chạm & Hàng loạt**:
   - Tự động kết nối ADB qua mạng Wi-Fi/LAN (`adb connect <ip>:5555`).
   - Hỗ trợ chọn nhiều thiết bị để kết nối hoặc khởi động lại cùng lúc.

4. **Bộ công cụ Sửa lỗi Thiết bị (Quick Fixes)**:
   - 🔄 **Khởi động lại app Smart Display**: Tắt và mở lại ứng dụng ngay lập tức (`am force-stop` & `monkey`).
   - 🧹 **Xóa dữ liệu & Cache app**: Reset trạng thái app (`pm clear vn.hongngoc.smartdisplay`).
   - ⚡ **Khởi động lại thiết bị (Reboot)**: Khởi động lại hệ điều hành Android (`adb reboot`).
   - 🎮 **Bàn phím điều khiển từ xa**: Phím Home, Back, Menu, OK, D-Pad, Tăng/Giảm âm lượng, Wakeup.
   - ⌨️ **Gửi văn bản**: Gõ URL, tài khoản, mật khẩu gửi trực tiếp vào ô nhập liệu của màn hình.

5. **Xem Màn hình Trực tiếp (Live Screen Viewer)**:
   - Chụp ảnh màn hình thiết bị theo thời gian thực.
   - Tự động làm mới mỗi 3 giây.
   - Nhấp chuột trực tiếp lên ảnh màn hình để Chạm (Tap) điều khiển từ xa.

6. **Quản lý & Cài đặt Ứng dụng (APK Manager)**:
   - Kho lưu trữ file APK (Smart Display Client, AnyDesk, TeamViewer QuickSupport, YouTube,...).
   - Tải lên APK mới trực tiếp qua giao diện web.
   - Cài đặt 1-chạm hoặc cài hàng loạt cho nhiều thiết bị cùng lúc.
   - Xem danh sách ứng dụng đang cài trên thiết bị và hỗ trợ gỡ cài đặt (`uninstall`).

7. **Realtime Logcat & ADB Shell Terminal**:
   - Xem nhật ký hệ thống qua WebSocket theo thời gian thực, lọc theo Level (Verbose, Debug, Info, Warning, Error).
   - Terminal gõ lệnh `adb shell` trực tiếp với các lệnh gợi ý nhanh (IP, CPU, RAM, Disk, Resolution).

## 🛠️ Hướng Dẫn Sử Dụng

1. **Khởi động Server**:
   - Nhấp đúp vào file `start.bat` hoặc chạy lệnh:
     ```bash
     npm start
     ```
2. **Truy cập Dashboard**:
   - Mở trình duyệt web và truy cập: **[http://localhost:3000](http://localhost:3000)**
3. **Đồng bộ từ Cloud**:
   - Bấm nút **"Đồng bộ Cloud"** trên góc trên thanh công cụ.
   - Nhập tài khoản và mật khẩu của hệ thống Smart Display để tải danh sách toàn bộ thiết bị.
4. **Kết nối & Sửa lỗi**:
   - Bấm **"Kết nối ADB"** trên thẻ thiết bị.
   - Bấm **"Sửa lỗi"** để mở bảng điều khiển với đầy đủ tính năng.
