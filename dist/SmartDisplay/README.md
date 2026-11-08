# SmartDisplay ADB Manager - Bộ cài Windows

## 🚀 Cài đặt nhanh (1 click)
1. Copy toàn bộ folder này sang máy Windows
2. Chạy **`cai-dat.bat`** (chuột phải → Run as Administrator)
3. Xong! App tự chạy + tự khởi động cùng Windows (không hiện cửa sổ)

## 📁 Các file trong bộ cài

| File | Chức năng |
|------|-----------|
| `cai-dat.bat` | Cài đặt tự động (chạy 1 lần) |
| `Chay_SmartDisplay.bat` | Chạy nhanh (không cài auto-start) |
| `Chay_An_SmartDisplay.vbs` | Chạy ẩn (không hiện terminal) |
| `Tat_SmartDisplay.bat` | Tắt ứng dụng |
| `Go_Cai_Dat.bat` | Gỡ cài đặt (xóa auto-start) |

## ⚙️ Yêu cầu
- Windows 10/11
- [Node.js](https://nodejs.org/) (nếu chưa có EXE)
- ADB (platform-tools) nếu muốn điều khiển thiết bị

## 🌐 Truy cập
Mở trình duyệt: **http://localhost:8686**

## 🔄 Cập nhật
1. Chạy `Tat_SmartDisplay.bat`
2. Copy file mới vào folder
3. Chạy `Chay_SmartDisplay.bat`

## ❓ Xử lý lỗi
- **Port 8686 bị chiếm:** Chạy `Tat_SmartDisplay.bat` rồi chạy lại
- **Không chạy ẩn:** Cài Node.js hoặc build EXE bằng `cai-dat.bat`
- **Lỗi ADB:** Tải platform-tools vào folder `platform-tools/`
