# NonLa Wander — Đặc tả sản phẩm đã duyệt

Tài liệu dùng để triển khai và nghiệm thu. Trạng thái code của repo trên máy phát triển cần được đối chiếu riêng.

## 1. Mục tiêu và phạm vi

Giúp khách Việt khám phá món ăn, hoạt động, địa điểm và sự kiện ở Hà Nội, rồi lập lịch trước chuyến đi. Khách có thể hoàn thành toàn bộ hành trình bằng thao tác thủ công hoặc sử dụng AI bất kỳ lúc nào trong chuyến. Thiết kế ưu tiên điện thoại, gợi cảm giác cẩm nang đi bộ Hà Nội. Prototype bắt đầu với khoảng 10 địa điểm demo quanh Hồ Gươm và Phố cổ. Đi bộ là phương tiện tính được trong phạm vi ban đầu. Giao diện cần thể hiện phạm vi dữ liệu và phương tiện được hỗ trợ.

## 2. Chuyến đi và đầu vào

Tạo chuyến từ Home hoặc My Projects. Mỗi chuyến có một lịch theo giờ, các mục đã lưu, một cuộc trò chuyện và tiến độ lập lịch AI riêng. Mỗi bước mở chuyến có một quyết định.

1. Chọn ngày và giờ bắt đầu, kết thúc theo giờ Hà Nội. Kết thúc phải sau bắt đầu. Giữ dữ liệu đã nhập và bước hiện hành khi tải lại.
2. Chọn Tự xếp lịch hoặc Nhờ AI lập lịch. Cả hai mở cùng lịch nháp trống. Lựa chọn thứ hai mở ngay công cụ Lập lịch cùng AI. Cho quay lại sửa thời gian trước khi chọn cách lập lịch. Chuyến đã thiết lập mở thẳng vào lịch.

Khách có thể đổi tên chuyến và lưu địa điểm hoặc trải nghiệm trước khi có ngày. Số người là số nguyên dương, mặc định 1 khi chưa có giá trị. Ngân sách ₫/người áp dụng cho cả chuyến. Lập lịch cùng AI dùng thời gian đã chọn và thu thập số người, vibe, món/hoạt động, khu vực, ngân sách mỗi người, phương tiện và các địa điểm muốn ghé. Chat tiếp nhận câu hỏi tự do về chuyến. Đi bộ là phương tiện hiện có dữ liệu để tính.

## 3. Khám phá và thư viện

Home, My Projects và Library dùng thanh điều hướng chung trên đầu trang. Trong chuyến, Thư viện mở cạnh lịch trên desktop và có lối quay về lịch trên màn hình hẹp. Khách tìm bằng từ khóa tiếng Việt có hoặc không dấu. Dữ liệu demo cho biết khu vực, giá, thời lượng và giờ mở cửa khi có.

Lưu một trải nghiệm ghi nhận ý muốn thử. Lưu một địa điểm ghi nhận nơi cụ thể. Hai danh sách lưu riêng và có thể giữ mục khi chuyến chưa có thời gian. Khách chọn một địa điểm cụ thể trước khi đưa trải nghiệm vào lịch. Khi chọn Thêm vào lịch, giữ địa điểm và chuyến đã chọn qua các bước còn thiếu. Tạo một lượt mới hoặc gắn địa điểm vào sự kiện hiện có tùy điểm bắt đầu của thao tác.

## 4. Hỏi ý kiến AI và Lập lịch cùng AI

Hai công cụ chạy bằng dữ liệu demo trong trình duyệt, không gọi API. Desktop mở một panel bên phải lịch tại một thời điểm. Trên màn hình hẹp, panel mở toàn màn hình và khi đóng trả về đúng chuyến, ngày đang xem và nút đã mở công cụ.

### Hỏi ý kiến AI

Hội thoại tự do lưu theo từng chuyến. Câu hỏi tư vấn, kể cả câu có chữ “thêm”, chỉ nhận câu trả lời. Lệnh rõ về một đối tượng có thể cập nhật nháp sau khi bộ tính lịch xác nhận hợp lệ. Hỏi lại khi thiếu tên nơi, ngày, giờ hoặc có nhiều đối tượng phù hợp. Khi xung đột, nêu lý do và giữ nháp. Khi ghi thành công, nêu thay đổi và cho hoàn tác. Đề xuất dùng để cân nhắc giữ cách xem trước và kiểm tra lại lịch trước khi ghi.

### Lập lịch cùng AI

Dùng thời gian chuyến đã chọn. Mỗi bước hiển thị một câu hỏi, tiến độ và giá trị đã có để sửa. Vibe và khu vực có thể chọn nhiều mục. Với câu mở, nhập qua + Khác và giữ các lựa chọn đã chọn. Bấm Xác nhận để đi tiếp, Quay lại để sửa, hoặc Bỏ qua ở bước tùy chọn. Tiến độ và câu trả lời lưu riêng theo chuyến, kể cả khi chuyển công cụ hoặc tải lại.

Chỉ nút cuối Tạo lịch nháp hoặc Cập nhật lịch nháp bắt đầu xếp. Đọc nháp mới nhất và kiểm tra bằng bộ tính lịch thủ công trước khi ghi. Giữ sự kiện tự tạo, ưu tiên gắn địa điểm phù hợp vào sự kiện chưa có nơi, giữ ID và giờ nếu vừa. Báo sự kiện mới, địa điểm đã gắn và nhu cầu chưa xếp được. Xác nhận lặp lại cho cùng lượt chỉ trả kết quả đã có. Có thể hoàn tác lần lập lịch vừa áp dụng. Bản chốt chỉ thay khi khách chốt lại.

## 5. Lịch theo giờ

Một ngày một cột trên desktop. Chuyến 2–7 ngày hiện các ngày của chuyến. Chuyến dài hơn chia trang tối đa bảy ngày, có nhãn khoảng ngày và nút trước/sau. Mobile hiện một ngày và dải chọn ngày. Làm mờ phần ngày đầu/cuối nằm ngoài khung chuyến. Chỉ ghi sự kiện trong khung hợp lệ.

Thanh công cụ chuyến gồm Tạo sự kiện, Thư viện, Hỏi ý kiến AI và Lập lịch cùng AI, ở bên trái trên desktop. Tạo bằng nút hoặc kéo chọn giờ. Sự kiện có tên, danh mục, giờ bắt đầu và kết thúc với thời lượng dương. Danh mục gồm Tham quan, Ăn uống, Cà phê, Giải trí, Di chuyển, Nghỉ ngơi và Khác. Vị trí là tùy chọn. Khách có thể tạo “Ăn trưa” trước rồi gắn quán, giữ ID và khung giờ khi vừa. Nếu chưa vừa, hiển thị tác động và xin xác nhận trước khi đổi giờ.

Di chuyển là sự kiện có khung giờ đi lại riêng. Cho nhập điểm đi và điểm đến nếu biết. Với hai lượt ghé và một sự kiện Di chuyển trùng chặng, dùng thời gian đã dành cho chặng một lần. Chặng đi bộ ước tính giữa hai nơi dùng dữ liệu hiện có. Thời gian ước tính để ở trạng thái chưa xác định khi thiếu hai đầu chặng.

Chi phí mỗi người và cả nhóm dùng cùng chi phí lượt ghé. Ghi số người, số lượt chưa biết giá và phân biệt miễn phí. Khách tự sửa số người hoặc ngân sách ngay cạnh phần tổng kết chi phí. Giờ mở cửa thường là cảnh báo. Giờ sự kiện cố định là mốc kiểm tra. Chuyến cũ đưa các lượt ghé lên lịch theo chính ngày giờ đã tính.

## 6. Chỉnh lịch và quyền thao tác của AI

Menu mỗi sự kiện có Sửa, Đổi ngày/giờ, Nhân bản và Xóa. Desktop cho kéo thẻ sang ngày/giờ khác, kéo mép để thay thời lượng và xem trước giờ khi kéo. Bàn phím và cảm ứng dùng biểu mẫu tương đương. Nhân bản sinh ID mới. Hoàn tác tác động vào chuyến hiện hành.

Thao tác tay và demo dùng cùng bộ lệnh tạo, sửa, gắn hoặc thay địa điểm, dời, đổi thời lượng, nhân bản và xóa. Kiểm tra sự kiện trùng nhau, phạm vi chuyến, ngân sách, thời lượng ghé, chặng đi và mốc cố định trước khi ghi. Nếu từ chối, nêu xung đột và giữ dữ liệu cũ. Khi áp dụng đề xuất, kiểm tra lại nháp mới nhất. Thay đổi dữ liệu liên quan yêu cầu duyệt lại. Đổi tên chuyến không làm mất hiệu lực của đề xuất.

## 7. Lưu và mở lại

Nháp, cuộc trò chuyện và tiến độ lập lịch AI tự lưu trên trình duyệt. Đề xuất đang chờ không sửa lịch. Chốt lịch giữ phiên bản theo giờ cùng số người và giá tại thời điểm chốt. Các chỉnh sửa sau đó chỉ ghi nháp. Chỉ thao tác Cập nhật lịch đã chốt mới thay bản chốt. Đăng nhập và lưu theo tài khoản thuộc giai đoạn sau.

## 8. Ngân sách OpenAI khi deploy thử

Ngân sách API là 50 USD cho toàn đợt thử, dành 45 USD cho ứng dụng và 5 USD dự phòng. Hosting, bản đồ và cơ sở dữ liệu tính riêng. Backend kiểm tra phần đã tiêu cùng chi phí đang giữ chỗ trước mỗi lượt gọi. Giữ chỗ theo ước tính chặn trên phù hợp với model và giới hạn đầu ra, thực hiện nguyên tử khi có nhiều yêu cầu đồng thời. Quyết toán theo usage thực tế. Khi chưa xác định được một lượt lỗi có bị tính phí hay không, giữ khoản ước tính để đối soát. Từ chối lượt gọi nếu ngân sách còn lại không đủ. Luồng thủ công vẫn hoạt động.

Ghi số lượt, token vào/ra và chi phí ước tính theo tác vụ gợi ý, hỏi thông tin và chỉnh bằng chat. Đo chi phí trung bình cho một chuyến có dùng AI để ước tính sức phục vụ. Model, giá và quy mô tập ứng viên là cấu hình triển khai cần đo. Các số 8 ứng viên, 3 gợi ý hoặc 3 tuyến tạm là giá trị thử nghiệm.

## 9. Nghiệm thu và đánh giá

| Tình huống | Kỳ vọng |
|---|---|
| Luồng thủ công | Tạo chuyến → chọn thời gian → tạo Ăn trưa → dời giờ → gắn quán giữ ID → thêm chặng Di chuyển → tải lại → chốt → sửa nháp. Không phát sinh lượt gọi AI. |
| Một ngày, ba ngày không trọn và trên bảy ngày | Đúng số cột, dải ngày và phân trang. Phần ngoài khung được làm mờ và không lưu được sự kiện. |
| Chuyến đã lưu từ trước | Hiện các lượt ở giờ đã tính. Sau khi sửa và tải lại, thấy cùng một lịch. Chuyến khác giữ nguyên. |
| Hỏi ý kiến AI | Câu tư vấn có chữ “thêm” giữ nguyên nháp. Lệnh đủ thông tin ghi đúng sự kiện nếu hợp lệ. Giữ hội thoại theo chuyến và cho hoàn tác. |
| Lập lịch cùng AI | Sửa câu trả lời rồi tải lại tiếp tục đúng bước. Xác nhận cuối áp dụng một lần trên nháp mới nhất. Giữ sự kiện thủ công và bản chốt. |
| Hai phường ưu tiên và chọn một món | Gợi ý điểm thực hiện món đó theo dữ liệu. Một lịch hợp lệ có thể chỉ ghé một trong hai phường. |
| Đính kèm cùng thẻ với ba câu lệnh | Hỏi chỉ trả lời. Cân nhắc cho xem tác động. Lệnh thêm rõ ràng cập nhật đúng nháp nếu hợp lệ. |
| Sửa lịch trong lúc AI đang xử lý | Đề xuất cũ không đưa điểm vừa bỏ trở lại. Đổi tên đơn thuần vẫn cho áp dụng. Chuyến khác không bị tác động. |
| Thiếu giá, thiếu giờ hoặc API lỗi | Giờ mở cửa là tham khảo. Tổng tiền thể hiện phần thiếu. Khách tiếp tục tự xếp. |
| Chốt rồi chỉnh tiếp | Mở lại thấy bản chốt và nháp đúng trạng thái. Chỉ xác nhận cập nhật mới thay lịch chốt. |
| Nhiều yêu cầu gần trần 45 USD | Tổng đã chi và đã giữ chỗ không vượt trần ứng dụng. Chức năng thủ công vẫn dùng được. |

Đánh giá gợi ý theo hai cách trên cùng dữ liệu và đầu vào: luật đơn giản và có LLM. Đo tỷ lệ ID hợp lệ, mức phù hợp với ý định, lý do có căn cứ, thời gian phản hồi và token. Thử đổi riêng vibe để kiểm tra lý do hoặc thứ tự có phản ánh mong muốn mới. Các ca trên là tiêu chí cần chạy khi triển khai.
