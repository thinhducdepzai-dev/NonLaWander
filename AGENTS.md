# NonLa Wander

NonLa Wander giúp khách khám phá Hà Nội và lập lịch đi chơi trong từng chuyến riêng. Đọc SPEC.md trước khi sửa hành vi sản phẩm. Đặc tả mô tả đích triển khai đã duyệt. Kiểm tra code thực tế để xác định phần đã có.

## Làm việc trong repo

- Môi trường mục tiêu là Node.js 22.17.1 và npm 10.9.2. Đọc README, package.json, lockfile và hướng dẫn tại thư mục đang sửa. Dùng script có thật trong repo để chạy, build và kiểm tra.
- Theo luồng thật từ giao diện tới dữ liệu trước khi chỉnh sửa. Tái sử dụng stack và các hàm xử lý hiện có. Khi yêu cầu chỉ liên quan một luồng, giới hạn thay đổi ở các phần cần thiết cho luồng đó.
- Dùng ID ổn định cho chuyến, buổi, điểm trong lịch và mục thư viện. Tên hiển thị có thể đổi. Nút bấm, kéo thả và chat phải gọi cùng logic cập nhật lịch, tính thời gian, chi phí và phát hiện xung đột.
- Tách lịch đã chốt, nháp đang sửa và đề xuất AI. Khi áp dụng một đề xuất, kiểm tra lại trạng thái liên quan. Việc đổi tên chuyến không làm mất hiệu lực của đề xuất cho một buổi.
- Đặt lời gọi OpenAI và khóa API ở backend. Kiểm tra ID ứng viên và dữ liệu trả về trước khi dùng. Mọi lượt gọi, kể cả thử lại, đều đi qua cùng cơ chế kiểm soát chi phí trong SPEC.md.
- Duy trì luồng thủ công chạy độc lập với AI. Dữ liệu mẫu ghi rõ là demo. Mô tả giờ mở cửa như thông tin tham khảo và chỉ dùng giá có căn cứ khi cộng chi phí.
- Bản test lưu trên trình duyệt. Đăng nhập và lưu theo tài khoản thuộc giai đoạn sau. Thực hiện theo phạm vi được giao từng lần.

## Xác minh thay đổi

Chọn ca nghiệm thu tương ứng trong SPEC.md và chạy qua đường vào người dùng thực sự sử dụng. Với luồng chỉnh sửa, kiểm tra thêm một buổi hoặc chuyến ngoài phạm vi thay đổi. Với luồng lưu, tải lại trang. Báo rõ ca đã chạy, kết quả và phần mới chỉ đối chiếu qua code. Dùng dữ liệu thử cố định để so sánh các phiên bản gợi ý.
