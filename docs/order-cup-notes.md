# THE KHE: đơn nhiều người và phiếu pha chế

## Cách sử dụng

- Mở màn nhân viên tại `/#/staff`, thêm món và số lượng như trước.
- Mỗi dòng có người nhận/nhóm, ghi chú pha chế, topping, độ ngọt và lượng đá. Những yêu cầu này áp dụng cho toàn bộ số lượng trên dòng đó.
- Khi các ly khác yêu cầu: dùng **Tách 1 ly** hoặc **Tách từng ly**, sau đó sửa đúng dòng. Ví dụ 4 ly trà sữa gồm 2 ly thường và 2 ly không topping.
- Tên khách mua/tích điểm và ghi chú chung ở cuối đơn vẫn dành cho cả đơn.
- Danh sách đơn và hóa đơn thể hiện người nhận cùng yêu cầu riêng của mỗi dòng.
- Mở bill, chọn **Phiếu pha chế**, xem **Gom theo món** khi pha và **Theo người nhận** khi giao. Chọn **In / Lưu PDF** để in đúng loại phiếu đang xem. Phiếu pha chế không hiện tiền.
- Số `#01`, `#02-03` trên phiếu là vị trí ly/phần trong đơn, giữ nguyên giữa hai cách xem.

## Lưu trữ và tương thích

Các thông tin nằm trong JSON `orders.items`: `lineKey`, `recipientName`, `lineNote`, `toppingMode`, `ice`, `sweetness`. Không cần migration. `id` tiếp tục là mã sản phẩm để tồn kho, doanh thu và giá vốn tính đúng. Tách dòng giữ nguyên tổng số lượng, giá thường, giá Grab và giá vốn. Các món thêm và ghi chú đơn online cũ được giữ khi sửa đơn.

Lựa chọn topping ở đây là yêu cầu pha chế. Nó không tự gỡ món thêm đã tính tiền hoặc thay định lượng công thức trong kho. Cần sửa món thêm trong đơn nếu muốn đổi số tiền.

Phạm vi triển khai là màn nhân viên trên GitHub Pages và bill của màn đó. Trang đặt hàng của khách đang chuyển hướng sang `the-khe-order.minhthupq98.chatgpt.site`; trang bên đó không được thay đổi trong đợt này.

## Kiến trúc bản hiện tại

Repo được cấp chỉ có tài nguyên đã biên dịch của app Order. `assets/order-cups-v1.js` giữ mã nguồn dễ đọc, dùng renderer/hook Preact của app đang chạy. `scripts/build-cup-notes.mjs` kiểm mã băm Git của bundle gốc `assets/index-BpABOaN7.js`, thay đúng các điểm tích hợp đã kiểm, rồi tạo `assets/staff-cup-notes-v1.js`. Nếu bundle gốc đổi, script dừng để kiểm tra lại. Không sửa bundle gốc hoặc tài nguyên `ops/`.

Chạy `npm run build`, `npm test`. Kiểm trình duyệt: `node test/cup-notes-browser.mjs` trên máy có `playwright-core` và Chromium, với HTTP server tại `127.0.0.1:8107`. Có thể đặt `PLAYWRIGHT_MODULE` và `CHROME` để dùng bộ cài có sẵn. `TEST_BASE` đổi URL kiểm tra, `TEST_OUTPUT` đổi nơi lưu ảnh/PDF. Bộ kiểm trình duyệt chặn toàn bộ mạng ngoài và mô phỏng đăng nhập, menu, tạo/sửa/mở lại đơn; không tạo đơn thật. GitHub Actions kiểm test logic, cú pháp và khả năng tạo lại bundle khớp bản đã cam kết.

## Quay lại phiên bản trước

Đổi tham chiếu script trong `index.html` về `/assets/index-BpABOaN7.js` và bỏ `cupStylesheet`. Dữ liệu JSON đã lưu vẫn giữ nguyên. Không cần hoàn tác database. Lưu ý giao diện cũ không chỉnh sửa được người nhận/ghi chú riêng của staff; không dùng giao diện cũ để sửa đơn mới nếu muốn giữ thao tác thuận tiện.
