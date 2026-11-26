# NonLa Wander

## Giao diện

Dùng ngôn ngữ cẩm nang in cho một công cụ lên lịch bằng tiếng Việt. Màn hình hẹp đọc theo thứ tự giới thiệu, form rồi lịch. Từ 900 px, đặt form và lịch cạnh nhau để dễ đối chiếu. Giữ tranh Hồ Gươm gọn để phần lên lịch xuất hiện sớm.

## Màu và chữ

- Nền giấy ngà `#f6f0e5`, thẻ `#fffcf6`, mực `#2d2922`.
- Đỏ gạch `#963b2c` cho thao tác chính, giờ đến và trạng thái lựa chọn. Xanh ô liu `#465943` cho tóm tắt chi phí. Cảnh báo dùng nâu `#735024` trên nền `#f5ead5`, kèm biểu tượng và chữ.
- Dùng Georgia cho tiêu đề và chữ hệ thống cho form và timeline. Cả hai tải từ thiết bị. Số tiền và giờ dùng chữ số cùng độ rộng khi phông chữ hỗ trợ.
- Tranh và nhãn dùng dạng tĩnh. Kiểm tra viền focus, tên điều khiển và thao tác bàn phím. Ưu tiên vùng chạm từ 44 px cho các điều khiển chính và tôn trọng thiết lập giảm chuyển động.

## Tương tác

- Dùng trường ngày, giờ, hộp kiểm và nút radio gốc. Chỉ mở trường giờ khi buổi được chọn.
- Tóm tắt lỗi nhận focus sau khi gửi form và dẫn tới từng trường. Cảnh báo trong lịch nằm cạnh buổi hoặc điểm liên quan.
- Mở **Lịch của tôi** để tạo hoặc chọn chuyến. Trong mỗi chuyến, nút **Lịch mẫu** nạp form ba ngày với hai buổi. Bấm **Chỉnh sửa** để hiện nút Lên, Xuống và Bỏ, kèm thao tác hoàn tác khi bỏ điểm.
