# NonLa Wander — Đặc tả sản phẩm đã duyệt

Tài liệu dùng để triển khai và nghiệm thu. Trạng thái code của repo trên máy phát triển cần được đối chiếu riêng.

## 1. Mục tiêu và phạm vi

Giúp khách Việt khám phá món ăn, hoạt động, địa điểm và sự kiện ở Hà Nội, rồi lập lịch trước chuyến đi. Khách có thể hoàn thành toàn bộ hành trình bằng thao tác thủ công hoặc sử dụng AI bất kỳ lúc nào trong chuyến. Thiết kế ưu tiên điện thoại, gợi cảm giác cẩm nang đi bộ Hà Nội. Prototype bắt đầu với khoảng 10 địa điểm demo quanh Hồ Gươm và Phố cổ. Đi bộ là phương tiện tính được trong phạm vi ban đầu. Giao diện cần thể hiện phạm vi dữ liệu và phương tiện được hỗ trợ.

## 2. Chuyến đi và đầu vào

Từ Lịch của tôi, chọn Tạo chuyến đi để mở một chuyến trống có tên mặc định. Cho đổi tên bất kỳ lúc nào. Người dùng có thể lưu trải nghiệm trước khi biết ngày đi. Mỗi chuyến có lịch trình, mục đã lưu, thông tin chuyến và panel AI riêng.

| Đầu vào | Cách sử dụng |
|---|---|
| Ngày đến/rời, các buổi sáng, chiều, tối | Từng ngày cho chọn nhiều buổi hoặc bỏ cả ngày. Mỗi buổi có giờ bắt đầu/kết thúc mặc định sửa được. Khi xếp lịch cần có buổi đích hợp lệ. |
| Số người và ngân sách | Nhập số người nguyên dương. Ngân sách mỗi người dành cho toàn chuyến. Khoản chi theo nhóm tính một lần rồi chia cho số người. |
| Vibe, món, hoạt động, địa điểm | Gợi ý đặc sản và cho nhập nhu cầu riêng. Địa điểm đích danh là tùy chọn, được ưu tiên và có phản hồi nếu chưa xếp được. |
| Phường ưu tiên | Chọn được nhiều phường trên bản đồ. Làm đậm phường đã chọn và cho xem đặc điểm, món ăn, hoạt động. Dùng để ưu tiên ứng viên. |
| Phương tiện, xuất phát | Tính di chuyển theo phương tiện được hỗ trợ. Khi chưa có điểm xuất phát, ghi rõ thời gian di chuyển được tính từ điểm ghé đầu tiên. |

Các nhóm lựa chọn có chỗ nhập yêu cầu riêng. Nếu phiên bản đang chạy chỉ lưu phần nhập tự do, giao diện phải nêu rõ mức xử lý đó.

## 3. Khám phá và thư viện

Thư viện là mục riêng trên sidebar/bottom navigation, đồng thời có thể mở cạnh lịch trong chuyến. Danh mục gồm Ăn uống, Thể thao, Vui chơi & tham quan, Sự kiện. Ăn uống có bộ lọc như món đặc sản, nhà hàng, quán vỉa hè và cà phê. Sự kiện có thể xem theo ngày chuyến đi.

Một trải nghiệm có thể thực hiện ở nhiều nơi. Lưu “cà phê trứng” ghi nhận ý thích. Lưu một quán ghi nhận địa điểm cụ thể. Lưu một mục vào chuyến và thêm mục đó vào lịch là hai thao tác riêng. Trang chi tiết thể hiện đặc trưng, khu vực, món/hoạt động, khoảng giá và giờ mở cửa khi có dữ liệu. Thông tin về bàn ngồi nằm ngoài tiêu chí gợi ý. Sự kiện có ngày giờ xác định để kiểm tra tính khả thi.

Cho đính kèm thẻ trải nghiệm hoặc địa điểm vào chat. Đính kèm chỉ cung cấp ngữ cảnh. Ví dụ “quán này có gì hay?” mở trao đổi, còn “thêm quán này vào chiều thứ Bảy” yêu cầu chỉnh lịch.

## 4. Gợi ý bằng AI

1. Lấy ứng viên từ thư viện theo yêu cầu. Món cụ thể lấy nơi có món đó. Vibe rộng lấy từ nhiều nhóm phù hợp. Ưu tiên phường đã chọn và xét ngày của sự kiện.
2. Mỗi lượt gợi ý thông thường gọi LLM một lần với câu gốc, ngữ cảnh cần thiết của chuyến đang mở và danh sách ứng viên ngắn. Yêu cầu trả ID và lý do dựa trên dữ liệu. Khách chưa biết muốn gì có thể được gợi ý vài kiểu đi chơi.
3. Kiểm tra ID thuộc tập ứng viên và hiển thị lý do giúp khách lựa chọn. Một địa điểm phù hợp là đủ nếu dữ liệu chỉ có một. “Gợi ý cho tôi” hiển thị lựa chọn. “Lên lịch giúp tôi” chuyển ứng viên được đề xuất sang bộ xếp lịch.
4. Khi không có ứng viên phù hợp trong khu vực, nêu giới hạn dữ liệu. Nếu có lựa chọn ở khu vực khác thì ghi rõ. Khi AI lỗi, giữ nội dung đã nhập và cho thử lại hoặc tiếp tục tự xếp.

## 5. Tạo lịch

Khách kéo thẻ từ thư viện vào đúng ngày, buổi và vị trí, hoặc dùng nút Thêm vào lịch trên điện thoại. Thẻ trải nghiệm cần chọn nơi thực hiện trước khi trở thành điểm ghé. Tuyến do AI gợi ý và tuyến thủ công dùng chung bộ tính lịch.

Thử một số hữu hạn phương án bằng code. Tôn trọng thứ tự khách yêu cầu, tính thời lượng ghé và thời gian di chuyển giữa hai điểm, dùng sự kiện giờ cố định làm mốc. Giờ kết thúc buổi là giới hạn trên. Có thể kết thúc sớm. Giờ mở cửa thông thường dùng để tham khảo. Kiểm tra ngân sách trên toàn chuyến. Khoản chưa có giá phải hiển thị riêng, ví dụ “đã tính 180.000đ/người, còn một điểm chưa có giá”.

Trả một lịch chính, nhóm theo ngày và buổi. Mỗi điểm hiện giờ đến, thời lượng, chi phí và chặng tới điểm kế tiếp. Tóm tắt buổi bằng số điểm, thời gian di chuyển và chi phí. Chỉ xếp được một phần thì trả phần đã có và lý do phần còn thiếu. Cho thử lại riêng buổi đó với ngân sách còn lại, bảo toàn các buổi khác.

## 6. Chỉnh lịch và quyền thao tác của AI

| Ý định | Hành vi |
|---|---|
| Hỏi thông tin | Trả lời trong chat. |
| Cân nhắc thêm hoặc đổi | Mô phỏng tác động về thời gian và chi phí. Người dùng quyết định áp dụng. |
| Lệnh rõ, sửa một điểm và không có xung đột | Áp dụng vào nháp, hỗ trợ hoàn tác. Nếu đối tượng mơ hồ thì hỏi đúng chi tiết còn thiếu. |
| Sửa cả buổi hoặc xảy ra xung đột | Cho xem trước, chỉ rõ điểm cần dời và lựa chọn xử lý. Chờ người dùng quyết định. |

Hỗ trợ thêm, bỏ, thay, đổi thứ tự. Chỉ tính lại các chặng liên quan, giờ các điểm chịu ảnh hưởng và tổng chi phí. Buổi khác được giữ nguyên. Nếu khách sửa nội dung liên quan trong khi AI đang xử lý, phải cập nhật đề xuất theo lịch mới trước khi áp dụng. Đổi tên chuyến không ảnh hưởng đề xuất lịch. Phạm vi kết thúc ở chuẩn bị trước chuyến đi.

## 7. Lưu và mở lại

Bản test tự lưu trên trình duyệt, ghi rõ phạm vi lưu. Tự lưu nháp sau mỗi thay đổi đã áp dụng. Đề xuất AI đang xem không ghi đè lịch. Khi Chốt lịch, lưu phiên bản đã chốt vào Lịch của tôi. Sửa tiếp từ phiên bản đó tạo nháp riêng. Chỉ cập nhật bản đã chốt khi khách chọn Cập nhật lịch đã chốt. Cho phép đổi tên mặc định. Mở lại phục hồi đúng lịch đã lưu. Đăng nhập và lưu theo tài khoản thuộc giai đoạn sau.

## 8. Ngân sách OpenAI khi deploy thử

Ngân sách API là 50 USD cho toàn đợt thử, dành 45 USD cho ứng dụng và 5 USD dự phòng. Hosting, bản đồ và cơ sở dữ liệu tính riêng. Backend kiểm tra phần đã tiêu cùng chi phí đang giữ chỗ trước mỗi lượt gọi. Giữ chỗ theo ước tính chặn trên phù hợp với model và giới hạn đầu ra, thực hiện nguyên tử khi có nhiều yêu cầu đồng thời. Quyết toán theo usage thực tế. Khi chưa xác định được một lượt lỗi có bị tính phí hay không, giữ khoản ước tính để đối soát. Từ chối lượt gọi nếu ngân sách còn lại không đủ. Luồng thủ công vẫn hoạt động.

Ghi số lượt, token vào/ra và chi phí ước tính theo tác vụ gợi ý, hỏi thông tin và chỉnh bằng chat. Đo chi phí trung bình cho một chuyến có dùng AI để ước tính sức phục vụ. Model, giá và quy mô tập ứng viên là cấu hình triển khai cần đo. Các số 8 ứng viên, 3 gợi ý hoặc 3 tuyến tạm là giá trị thử nghiệm.

## 9. Nghiệm thu và đánh giá

| Tình huống | Kỳ vọng |
|---|---|
| Tắt LLM | Tạo chuyến trống, tìm địa điểm, thêm ba điểm, kéo thả, đổi thứ tự, đổi tên, lưu, tải lại thành công với 0 lượt gọi. |
| Ba ngày chỉ chọn hai buổi | Chỉ hai buổi có lịch. Chi phí dùng chung ngân sách. Có thể để thời gian trống cuối buổi. |
| Hai phường ưu tiên và chọn một món | Gợi ý điểm thực hiện món đó theo dữ liệu. Một lịch hợp lệ có thể chỉ ghé một trong hai phường. |
| Đính kèm cùng thẻ với ba câu lệnh | Hỏi chỉ trả lời. Cân nhắc cho xem tác động. Lệnh thêm rõ ràng cập nhật đúng nháp nếu hợp lệ. |
| Sửa lịch trong lúc AI đang xử lý | Đề xuất cũ không đưa điểm vừa bỏ trở lại. Đổi tên đơn thuần vẫn cho áp dụng. Chuyến khác không bị tác động. |
| Thiếu giá, thiếu giờ hoặc API lỗi | Giờ mở cửa là tham khảo. Tổng tiền thể hiện phần thiếu. Khách tiếp tục tự xếp. |
| Chốt rồi chỉnh tiếp | Mở lại thấy bản chốt và nháp đúng trạng thái. Chỉ xác nhận cập nhật mới thay lịch chốt. |
| Nhiều yêu cầu gần trần 45 USD | Tổng đã chi và đã giữ chỗ không vượt trần ứng dụng. Chức năng thủ công vẫn dùng được. |

Đánh giá gợi ý theo hai cách trên cùng dữ liệu và đầu vào: luật đơn giản và có LLM. Đo tỷ lệ ID hợp lệ, mức phù hợp với ý định, lý do có căn cứ, thời gian phản hồi và token. Thử đổi riêng vibe để kiểm tra lý do hoặc thứ tự có phản ánh mong muốn mới. Các ca trên là tiêu chí cần chạy khi triển khai.
