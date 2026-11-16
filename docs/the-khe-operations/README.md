# THE KHE Operations — Đặc tả và bàn giao cho phiên lập trình

Ngày cập nhật: 17/11/2026 (Asia/Ho_Chi_Minh). Trạng thái: đặc tả và bộ kiểm thử đề xuất, chưa có triển khai tính năng mới.

## 1. Đọc trước khi viết code

- Mục tiêu: chủ quán thấy lãi thật, dòng tiền, điểm thất thoát, hiệu quả từng món/kênh và việc cần làm tiếp. Giữ app Order cho quầy/web, giữ luồng bill hiện hành. Mở rộng app tài chính thành màn quản lý chung nếu tìm được mã nguồn chạy được, tích hợp hóa đơn/kế toán, thêm AI sau khi số liệu đáng tin.
- Admin: https://minhthupq98-hub.github.io/#/staff. Menu khách: https://thekhecoffee.com/. Repo Pages đang chạy: minhthupq98-hub/minhthupq98-hub.github.io. Repo được kiểm tra có index.html và bundle đã build. Lần rà này chưa tìm được repo nguồn app tài chính trong các repo GitHub đã kết nối; đây không phải kết luận rằng mã nguồn không tồn tại.
- Những gì đã xác minh trước đây từ mã/app: đọc đơn, món, khách và thiết lập trong Supabase theo tài khoản; admin có tạo/đọc đơn, giá theo kênh, quản lý món, hiển thị/ẩn món, thành viên và báo cáo. Admin có thể giữ bản lưu trên thiết bị khi lần đồng bộ lỗi. App tài chính đã có theo mô tả và lịch sử: thu/chi, ảnh chứng từ, kho, nhập báo cáo Grab và báo cáo kỳ. Chưa nghiệm thu độ đầy đủ, hợp nhất và độ chính xác của app tài chính trên dữ liệu thật trong lần bàn giao này.
- Các phần bên dưới là yêu cầu và tiêu chí nghiệm thu, không phải danh sách tính năng đã hoạt động. Không dùng bundle Pages làm mã nguồn để sửa nghiệp vụ. Giữ link staff, quy tắc ẩn/hiện hiện có, mẫu bill và phân quyền đang chạy.
- Nơi phát triển: ưu tiên repo private chứa source app tài chính nếu tìm được và chạy được trên môi trường thử. Nếu chưa có source, bắt đầu mô-đun Operations riêng trong repo private với dữ liệu giả; kết nối Order qua hợp đồng đọc riêng. Nhánh tài liệu ở repo Pages là điểm bàn giao, không phải nơi đẩy code, dữ liệu quản trị hoặc triển khai sản phẩm.
- Xác minh hợp đồng dữ liệu và quyền trước khi nối production. Không commit dữ liệu đơn/khách, file Grab thật, giá vốn, công thức thực, chứng từ hoặc khóa. Tài liệu này chỉ dùng dữ liệu giả. Đặc tả không cấp quyền tạo/sửa đơn thử thật, áp migration lên production, gửi tin nhắn, phát hành hóa đơn hoặc nộp tờ khai.

## 2. Tự đánh giá khả năng vận hành

| Năng lực | Bằng chứng hiện có | Khoảng trống cần lấp trước khi coi là đạt |
| --- | --- | --- |
| Bán hàng và hóa đơn bán lẻ | App Order đang phục vụ quầy/web; admin và bill có sẵn. | Đối chiếu thanh toán tách phương thức, hoàn/hủy, trạng thái chế biến, ca và quyền duyệt. Phân biệt bill hiện có với chứng từ/hóa đơn điện tử. |
| Đồng bộ và quyền sở hữu dữ liệu | Cùng nguồn Supabase. Có đường đọc lại và dữ liệu lưu trên thiết bị. | Hiện lần đồng bộ thành công gần nhất, nguồn và phạm vi thiếu. Phân trang, ghi nhận thay đổi/hoàn/hủy, retry và phát hiện dữ liệu cũ. |
| Tiền thực nhận và lãi | Có chức năng báo cáo/thu chi theo lịch sử; nhập Grab theo tháng là luồng đã chốt. | Chưa đối chiếu đầu-cuối đơn, đợt chuyển khoản, phí, thuế, sổ chi và lãi. Chốt kỳ rồi xuất số không đổi khi mở lại. |
| Kho và định lượng | Có nhập kho và giá vốn theo lịch sử. | Kiểm quy đổi và sản lượng mẻ; kết nối trừ kho theo món/size/topping, kiểm kê thực tế, lô/hạn dùng, hao hụt. |
| Khách hàng và khuyến mãi | Có thành viên và Hội Nhà Khe. | Kiểm lịch sử sổ điểm, hiệu quả voucher, sự đồng ý nhận tin, khách quay lại và giới hạn quyền xem dữ liệu. |
| Ra quyết định, nhân sự, thuế | Yêu cầu đã có; chưa kiểm chứng tích hợp đầy đủ. | Đo theo KPI đáng tin, phân quyền, truy vết, xuất sổ kế toán, quy tắc thuế theo kỳ và đề xuất có bằng chứng. |

## 3. Danh mục chức năng và thứ tự

| Đợt | Phân hệ | Tác vụ và trường hợp dễ bỏ sót |
| --- | --- | --- |
| P0 | Màn chủ quán | Trang đầu có doanh thu ghi nhận, tiền về, lãi, tồn cần xử lý, đơn lệch và việc đến hạn. Bộ lọc kỳ/kênh, so kỳ, mở từ KPI xuống bản ghi. Hiển thị độ mới và độ đầy đủ dữ liệu. |
| P0 | Đơn và thu tiền | Nhận đơn quầy/mang đi/web/Grab, phân biệt nguồn và mã gốc; theo dõi đang làm, đã giao, đã/chưa thu khi dữ liệu hỗ trợ. Tách tiền mặt/chuyển khoản/tiền nền tảng. Tiền cọc, phụ thu, hoàn một phần, hủy kèm lý do, ghi nhận tiền thực nộp. Bảo toàn giá tại lúc bán và lịch sử. |
| P0 | Chốt ca và kiểm soát thất thoát | Tiền đầu ca, thu/chi tại quầy, đếm tiền cuối ca, kỳ vọng/thực tế, lý do chênh, bàn giao người phụ trách. Duyệt hoàn tiền, hủy hoặc giảm ngoài định mức, ghi nhật ký. |
| P0 | Grab và ngân hàng | Nhập CSV/Excel có màn xem trước. PDF/ảnh là dự phòng, OCR đến bản nháp. Tách ngày bán, ngày quyết toán và ngày tiền về; doanh thu, trợ giá từng bên, phí, hoàn, thuế và chuyển khoản; nhận file tổng hợp lẫn có dòng đơn. Kiểm nhập trùng, thiếu mã, nhiều đợt trả cho một kỳ, chốt có chứng từ. |
| P0 | Sổ quản trị và chứng từ | Thu/chi theo nhóm, công nợ nhà cung cấp, Grab phải thu, chi phí định kỳ, vốn chủ/tiền vay, tài sản/khấu hao quản trị khi bật. Báo cáo lãi lỗ tháng, quỹ tiền, dòng tiền và doanh thu tính thuế là các báo cáo riêng. Khóa kỳ, mở lại có quyền/lý do và theo dõi điều chỉnh. |
| P0 | Hóa đơn điện tử và thuế HKD | Hồ sơ hộ kinh doanh, địa điểm và ngành; bộ quy tắc hiệu lực theo kỳ; tách tiền được nộp thay, hồ sơ dự thảo, nhắc hạn, file xuất cho kế toán. Tích hợp nhà cung cấp có môi trường thử; lưu mã chứng từ, trạng thái gửi/nhận, xử lý trùng, lập điều chỉnh/thay thế theo trường hợp. |
| P1 | Mua hàng, nhà cung cấp và kho | Đơn mua, nhận từng phần, trả hàng, công nợ, biến động giá, đơn vị mua và đơn vị tồn. Sổ giao dịch kho, kiểm kê theo ca, điều chỉnh có duyệt, hao hụt/hủy/biếu/tặng/nội bộ, cảnh báo tồn thấp và cận hạn, xuất lô cận hạn trước khi phù hợp. |
| P1 | Sản xuất theo mẻ và giá vốn | Sản lượng thực thu của trà, kem, sốt; phiên bản công thức theo ngày hiệu lực và định lượng g/ml, size, đá/đường nếu ảnh hưởng, topping, bao bì, combo; hủy trước và sau chế biến có cách ghi kho khác nhau. So tiêu hao theo định mức và thực tế. |
| P1 | An toàn thực phẩm và chất lượng | Hồ sơ nguồn hàng theo lô, hạn dùng sau mở/nấu, nhiệt độ bảo quản, vệ sinh thiết bị, thành phần dị ứng, nhật ký khiếu nại, truy ngược lô khi có sự cố. Bật biểu mẫu pháp lý phù hợp loại hình sau khi đối chiếu quy định áp dụng. |
| P1 | Hiệu quả menu và giá | Lãi đóng góp theo món, size/kênh/khung giờ; món bán kèm, số ngày thực mở, thời gian hết hàng, tải thao tác, mức hao hụt, hòa vốn và mô phỏng giá/chi phí. Đo lãi tăng thêm sau chương trình. |
| P2 | Bếp/bar và phục vụ | Hàng đợi làm món theo quầy, ghi chú dị ứng, thời gian chờ, hết món, giao/nhận đơn. Bàn, tách/gộp bill, đặt chỗ và giao nội bộ bật khi mô hình cần. Đánh giá hiện trạng app Order trước khi thêm. |
| P2 | CRM, loyalty, chương trình | Dùng chung Hội Nhà Khe, sổ biến động điểm, khôi phục khi hoàn đơn theo quy tắc, sinh nhật, phân nhóm mua lại, voucher/combo theo ngày và kênh, hạn mức, chi phí ưu đãi và đồng ý nhận tin. |
| P2 | Nhân sự và vận hành | Lịch làm, chấm công, phân ca, chi phí nhân sự theo giờ bán, checklist mở/đóng quán, bảo trì máy, đào tạo và nhật ký sự cố. Lương, nhiều cửa hàng, kho trung tâm hoặc nguồn bán thêm bật khi có nhu cầu. |
| P2 | AI hỏi đáp và đề xuất | Hỏi bằng tiếng Việt, tóm tắt tuần, đọc chứng từ vào bản nháp, phát hiện bất thường, dự báo tồn, mô phỏng giá và đề xuất thử nghiệm. Gắn kỳ, bộ lọc và nguồn cho mỗi kết luận. |

P0/P1/P2 là thứ tự xây, không phải cam kết lịch. Nguyên tắc xuyên suốt: giao diện mobile cho chủ quán và thu ngân, thao tác nhanh có phím tắt khi phù hợp, thông báo lỗi và cách retry, quyền theo vai trò, nhật ký, xuất dữ liệu, backup và kiểm thử khôi phục.

## 4. Sổ số liệu, dữ liệu và tích hợp

1. App Order sở hữu đơn, mã khách/thành viên, trạng thái, giá lúc bán. Adapter Operations đọc quyền tối thiểu và chuẩn hóa. Dùng ID nguồn ổn định kèm đơn vị/kênh, version/cursor hoặc checkpoint đã xác minh, phân trang và dedupe; giữ cả hoàn/hủy. Hiển thị lần đồng bộ cuối, chứng cứ nguồn và khi nào số liệu chưa đủ để chốt. Ghi nguồn cho các chỉnh sửa quản trị và tách giao dịch bù khỏi dữ liệu gốc.
2. Các thực thể đề xuất (tên logic, chưa là tên bảng production): order/order_line/payment/refund, import_batch/settlement_line/payout, cash_session/expense, ingredient/supplier/purchase_receipt, stock_movement/stock_count/batch, recipe_version/recipe_component/cost_snapshot, customer_link/loyalty_entry/promotion, tax_rule/fiscal_document/period_close/audit_log. Kiểm tenant và địa điểm trong mỗi truy vấn, xử lý đồng thời và nhập lại theo khóa idempotency.
3. Lưu VND bằng số nguyên. Định lượng dùng decimal/đơn vị gốc và quy đổi có kiểm thử. Lưu dấu thời gian và ngày nghiệp vụ riêng, báo cáo quán theo Asia/Ho_Chi_Minh. Giữ ngày bán, ngày sửa/hoàn, ngày sàn chốt và ngày ngân hàng ghi có riêng. Giữ dấu vết từ nguồn đến báo cáo.
4. Doanh thu quản trị = giá trị món được ghi nhận sau giảm/hoàn theo quy tắc đã duyệt. Trợ giá do sàn chịu được lưu riêng để xác định khoản quán được hưởng. Lãi đóng góp = doanh thu quản trị − giá vốn − phí/chi phí biến đổi chưa được trừ. Lãi ròng quản trị còn tính chi phí cố định và các khoản vận hành khác. Không trừ khuyến mãi hoặc phí hai lần. Doanh thu tính thuế và thuế nộp thay do module quy tắc và chứng từ xác định, tách khỏi tiền về và chi phí vận hành.
5. File Grab có mã đơn: gắn dòng với đơn đã ghi, chỉ bổ sung phần tài chính chưa có. Dòng chưa khớp đưa vào bảng giải quyết. File chỉ có tổng: giữ số theo kỳ/đợt, đối soát tổng và gắn rõ phần chưa phân bổ; báo cáo lợi nhuận món theo kênh dùng nhãn ước tính hoặc thiếu dữ liệu. Không sinh đơn giả từ khoản chuyển ngân hàng. Hóa đơn và hệ thống kế toán xác nhận lại bản ghi qua mã trả về; gửi lại cùng yêu cầu phải chống trùng.
6. Vai trò: thu ngân thấy đơn/ca mình phụ trách; kho thấy nguyên liệu, tồn và nghiệp vụ kho; chủ thấy thông tin kinh doanh; kế toán có quyền soát chứng từ/kỳ được giao; AI đọc qua API đúng quyền người hỏi. Khóa và cấu hình tách staging/production. Kiểm dữ liệu khách khi xuất hoặc dùng OCR/AI, không log số điện thoại/địa chỉ/khóa.
7. Tuân thủ HKD: lưu hồ sơ và văn bản theo phiên bản. Kiểm lại NĐ 68/2026 được sửa bởi NĐ 141/2026 (ngưỡng 1 tỷ đồng/năm từ 01/01/2026), mẫu theo VBHN 24/2026/VBHN-BTC, điều kiện giảm TNCN theo NĐ 398/2026 và hướng dẫn về thuế sàn đã nộp thay. Cấu hình phương pháp theo trường hợp thật; nghiệm thu với kế toán và ví dụ có chứng từ trước khi sử dụng số để nộp. Không suy số thuế quán từ bản kế hoạch. Nguồn: [NĐ 68](https://vanban.chinhphu.vn/?docid=217111&pageid=27160), [NĐ 141](https://vanban.chinhphu.vn/?docid=217960&pageid=27160), [NĐ 398](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/11/398_2026_nd-cp_29102026-signed.signed.pdf), [VBHN 24](https://xaydungchinhsach.chinhphu.vn/van-ban-hop-nhat-24-2026-vbhn-tt-btc-ve-ho-so-thu-tuc-quan-ly-thue-119260814155824299.htm), [hướng dẫn doanh thu qua nền tảng](https://xaydungchinhsach.chinhphu.vn/co-can-khai-bao-doanh-thu-khi-ban-hang-qua-shopee-grab-be-cac-san-da-khau-tru-thue-119260721055834808.htm).

## 5. AI hỗ trợ quyết định

- Với món bán đều và mang tổng lãi cao: gợi ý giữ/ưu tiên. Bán nhiều nhưng lãi mỗi phần thấp: mô phỏng giá/định lượng riêng từng kênh. Lãi tốt nhưng ít bán: thử hiển thị/gợi ý bán kèm. Ít bán và lãi thấp: kiểm món đã hiện đủ ngày, vai trò giữ khách hoặc kéo món khác, lượng tồn riêng phải hủy, rồi mới đề xuất tạm ẩn.
- Đề xuất ngoài menu: ngày/giờ nên thử mở thêm, số người cần bố trí theo ca, lượng cần ủ theo mẻ, chi phí hoặc nhà cung cấp cần rà, ngân sách khuyến mãi, dòng tiền có đủ đến kỳ trả nhà cung cấp, và đơn/ca nào có chênh lệch cần điều tra.
- Mỗi đề xuất có số liệu, kỳ so sánh tương đương, lý do, độ đầy đủ, hành động, chỉ số đo và ngày xem lại. Ví dụ giảm lượng mẻ đầu, theo dõi đồng thời thiếu hàng cuối ca và phần hủy cuối ngày. Khi mẫu quá nhỏ hoặc thiếu phí/giá vốn, báo rõ phần chưa đủ để kết luận.
- Số liệu và quyền do hệ thống kiểm soát. AI được phép tạo nháp hoặc đề xuất có dẫn số; thao tác đổi giá/ẩn món, gửi tin, sửa sổ, chốt kỳ và phát hành chứng từ đi qua phân quyền và xác nhận của người được giao.

## 6. Ticket đầu tiên — đọc đơn mẫu và đối soát Grab

1. Xác định repo có source chạy được. Tạo nhánh riêng trong repo phát triển. Mô-đun đầu tiên gồm interface đọc Order, adapter mẫu, parser CSV, màn xem trước đối soát, dự thảo kết quả và test. Chọn stack đang có nếu nối app tài chính. Với mô-đun riêng, ghi lựa chọn stack và cách chạy ngay trong PR.
2. Kiểm trường và mapping từ nguồn đã cấp quyền trước khi chuyển production. Có thể bắt đầu bằng contract và dữ liệu minh họa bên dưới. Các cột CSV ở đây là mẫu test nội bộ, không phải cam kết định dạng xuất thực tế của Grab.
3. Dữ liệu thử tháng 10/2026 (giả lập, file [fixture JSON](./fixtures/grab-reconciliation.json)). Đơn Q-001 tại quầy ngày 30/10 thu tiền mặt 40.000đ, giá vốn 15.000đ. Đơn G-001 ngày 31/10 giá 60.000đ, quán chịu giảm 5.000đ, giá vốn 18.000đ, phí 10.000đ, không có hoàn, tiền Grab thực chuyển 45.000đ ngày 02/11. Phép thử gốc giả định không có thuế nộp thay.
   - Kỳ tháng 10: doanh thu quản trị 95.000đ, tiền nhận tháng 10 là 40.000đ, Grab chờ về 45.000đ, lãi đóng góp trước chi phí cố định 52.000đ. Tháng 11 nhận 45.000đ, khoản phải thu còn 0, không phát sinh thêm doanh thu từ lần chuyển này.
   - Tải cùng file hoặc cùng mã đối soát hai lần vẫn chỉ có một dòng nghiệp vụ. File bản sửa có chênh phải hiện bản so sánh. Tải file chỉ tổng tháng 45.000đ phải hiển thị chưa phân bổ từng món.
   - Biến thể: nền tảng giữ thêm 2.000đ có chứng từ nộp thay, thực nhận 43.000đ. Đối soát phải hiện riêng khoản 2.000đ; không ghi giảm doanh thu một lần nữa. Thử thiếu ID, sai dấu tiền, hoàn một phần, split payment, mở kỳ đã khóa, nguồn đồng bộ lỗi và truy cập sai vai trò.
4. Kết quả bàn giao code sau ticket: cách chạy và test, ảnh màn đối soát dùng dữ liệu giả, mô tả trạng thái lỗi và nhập lại, checklist phần còn cần xác minh trên file Grab thật. PR chỉ gồm phần ticket đang làm để dễ rà.

## 7. Đoạn giao việc cho phiên tiếp theo

> Đọc tài liệu này. Kiểm repo nguồn app tài chính THE KHE đang được cấp và xác định có chạy được hay không. Tiếp tục trên repo đó nếu phù hợp, hoặc tạo module Operations riêng trong repo private được giao. Làm ticket đầu tiên ở mục 6 bằng dữ liệu giả; giữ app Order/bill hiện tại. Báo commit/PR và kết quả test. Nếu thiếu quyền production, dùng adapter mẫu và ghi chính xác dữ liệu còn cần đối chiếu. Đừng sửa bundle đã build hoặc giả định đã kết nối thật.
