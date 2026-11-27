# Bàn giao ứng viên địa điểm · v1

Pipeline xuất một tệp JSON UTF-8 với cấu trúc dưới đây. Tệp [ví dụ](../examples/library-handoff-v1.json) gồm một mục có nguồn thật trong repo và các mục ghi `fixture: true` để thử lệnh.

```sh
npm run library:review -- examples/library-handoff-v1.json
```

Lệnh in Markdown ra stdout theo thứ tự ứng viên và nguồn trong tệp, dùng dữ liệu Library hiện có để đối chiếu. Lệnh chỉ đọc tệp cục bộ, không mở URL và không ghi dữ liệu. Lỗi cấu trúc, mã trùng và phiên bản chưa hỗ trợ được báo qua stderr với mã thoát 1.

## Cấu trúc

| Trường cấp lô | Kiểu | Ý nghĩa |
|---|---|---|
| `version` | Bắt buộc, số `1` | Phiên bản định dạng |
| `candidates` | Bắt buộc, mảng | Một ứng viên cho mỗi nơi hoặc chi nhánh mà pipeline có thể phân biệt. Dùng `[]` nếu lô trống. |

| Trường ứng viên | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | Bắt buộc, chuỗi chữ thường ASCII và số, có thể phân tách bằng `-`, `_`, `.`, `:` | Mã nguồn ổn định. Giữ mã khi sửa thông tin qua các lần giao. Mỗi mã chỉ xuất hiện một lần trong lô. Mã Library được đối chiếu riêng. |
| `name` | Bắt buộc, văn bản | Tên địa điểm hoặc tên thương hiệu nếu nguồn chỉ nhắc thương hiệu |
| `sources` | Bắt buộc, mảng có ít nhất một nguồn | Mục đầu là link thông tin trong bảng tóm tắt. Tất cả nguồn được liệt kê ở phần đối chiếu. |
| `branch` | Tùy chọn, văn bản | Tên chi nhánh do nguồn nêu. Bỏ trường này khi nguồn chỉ nhắc thương hiệu. |
| `address` | Tùy chọn, văn bản | Địa chỉ của nơi cụ thể. Giữ nguyên số nhà, phố và phần hành chính mà nguồn cung cấp. |
| `pricePerPersonVnd` | Tùy chọn, số nguyên không âm | Chi phí cho cả lượt ghé tính theo người, đơn vị ₫. `0` là miễn phí. Giá một món có thể ghi trong `sources[].note` để người duyệt tham khảo. |
| `coordinates` | Tùy chọn, `{ "lat": số, "lon": số }` | Tọa độ WGS84, vĩ độ từ −90 đến 90, kinh độ từ −180 đến 180 |
| `image` | Tùy chọn, đối tượng | Thông tin ảnh theo phần dưới |
| `fixture` | Tùy chọn, boolean | `true` ghi rõ ứng viên là dữ liệu thử. Chỉ dùng cho ví dụ hoặc kiểm thử. |

Bỏ hẳn trường tùy chọn khi thiếu dữ liệu. Trường văn bản phải có nội dung trên một dòng. URL phải là HTTP(S), dùng mã hóa URL cho ký tự như khoảng trắng hoặc `|`, và không chứa thông tin đăng nhập. Các khóa mở rộng chưa được định nghĩa sẽ được bỏ qua.

## Nguồn và quyền dùng ảnh

- `sources[]` có `url` và `supports` bắt buộc. `supports` là danh sách các trường có giá trị mà nguồn hỗ trợ, chọn từ `name`, `branch`, `address`, `pricePerPersonVnd`, `coordinates`. Mỗi trường chỉ liệt kê một lần trong một nguồn. Có thể thêm `title`, `checkedOn` theo `YYYY-MM-DD` và `note` để chỉ vị trí hoặc giới hạn của bằng chứng. Chỉ đánh dấu `branch` khi nguồn xác định được chi nhánh. Nguồn chỉ xác minh địa chỉ dùng `"supports": ["address"]`.
- `image.referenceUrl` là URL ảnh hoặc trang chứa ảnh. Có URL này là đủ để bàn giao ảnh tham khảo.
- `image.displayPermission` chỉ cung cấp khi có căn cứ về quyền hiển thị. Ghi `basis` với giá trị `license`, `permission` hoặc `owned`, cùng `evidenceUrl` dẫn tới bằng chứng cho đúng ảnh. `license` là tên giấy phép, bắt buộc với `basis: "license"`. Ghi `author` và các điều kiện trong `note` khi cần ghi công hoặc tuân thủ điều khoản. Mục có bằng chứng vẫn chờ người duyệt kiểm tra và quyết định dùng ảnh.

## Cách đọc kết quả

- **Có thể khớp ID** khi tên và địa chỉ ứng viên đều có nguồn, và tổ hợp đó khớp duy nhất với một địa chỉ trong `sourcedPlaces`. So khớp sau khi chuẩn hóa dấu, dấu câu và nhãn số nhà đầu dòng. Đây là đề xuất ghép.
- **Ứng viên mới** khi tên và địa chỉ đều có nguồn, và chưa thấy tên hoặc địa chỉ tương ứng trong Library.
- **Cần kiểm tra thêm** khi thiếu căn cứ về tên hoặc địa chỉ, hoặc tên và địa chỉ chưa chỉ ra một ID duy nhất. Báo cáo vẫn liệt kê ID liên quan để đối chiếu. Tên trùng ở các địa chỉ khác nhau xuất hiện thành các dòng riêng.

Bên dưới bảng, mỗi trường chỉ đến nguồn `S1`, `S2` tương ứng hoặc ghi rõ còn thiếu. Có thể bàn giao giá trị để người duyệt kiểm tra tiếp bằng cách giữ trường đó và bỏ nó khỏi `supports`. Bảng tóm tắt chỉ hiện chi nhánh có nguồn hỗ trợ. Giá demo của mục Library hiển thị riêng, kể cả khi lô mới có nguồn xác minh địa chỉ cho cùng mục.
