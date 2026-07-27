# The Khe · Order & Profit

Phần mềm order dành cho quán nhỏ, có quản lý món và cost, lưu đơn, tổng hợp doanh thu và tính lợi nhuận cuối ngày.

## Dữ liệu

Dữ liệu món, đơn hàng, chi phí và cài đặt được đồng bộ qua Supabase. Người dùng phải đăng nhập và Row Level Security (RLS) giới hạn dữ liệu theo tài khoản.

Lần đăng nhập đầu tiên trên thiết bị cũ sẽ chuyển menu và đơn đang lưu trong trình duyệt lên Supabase nếu tài khoản chưa có dữ liệu online.

Repository chỉ chứa mã giao diện, cấu hình kết nối công khai và schema database; không chứa mật khẩu, secret key hoặc dữ liệu kinh doanh thực tế.
