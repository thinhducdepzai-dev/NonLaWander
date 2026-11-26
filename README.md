# NonLa Wander

Prototype cẩm nang đi bộ Hà Nội bằng HTML, CSS và JavaScript thuần. Máy chủ Node phục vụ tài nguyên tĩnh. Bản chạy cục bộ dùng Node.js **22.17.1** và npm **10.9.2**, không cần cài thư viện.

## Chạy

```sh
npm run dev
```

Mở [http://127.0.0.1:3000](http://127.0.0.1:3000). Có thể đổi cổng bằng `PORT=3001 npm run dev`.

```sh
npm test
```

## Thử lịch mẫu

1. Từ **Lịch của tôi**, bấm **Tạo chuyến đi** rồi chọn **Lịch mẫu** để nạp ngày 27–29/11/2026. Lịch chỉ chọn sáng 27/11 (08:00–11:00) và chiều 28/11 (14:00–17:00). Ngày 29/11 nghỉ cả ngày.
2. Bấm **Xếp lịch đi bộ**. Kết quả gồm hai buổi, sáu điểm và tổng 200.000 ₫ mỗi người trên ngân sách 350.000 ₫.
3. Bấm **Chỉnh sửa** rồi chuyển Đền Ngọc Sơn xuống một vị trí. Cà phê Đinh lên đầu buổi lúc 08:00, Đền Ngọc Sơn lùi đến 08:57. Bỏ Đền Ngọc Sơn sẽ giảm tổng xuống 170.000 ₫ và báo thiếu điểm muốn ghé. Nút **Hoàn tác** khôi phục điểm vừa bỏ.
4. Nhập 100.000 ₫ vào ngân sách. Phần tóm tắt báo số tiền vượt ngay để bạn có thể bỏ bớt điểm hoặc xếp lịch lại. Các thay đổi khác của form được áp dụng qua **Xếp lịch đi bộ**.

Để thử cảnh báo giờ, chỉ giữ sáng 27/11, đặt 08:00–10:10 và chọn Phở Bát Đàn cùng Nhà cổ 87 Mã Mây làm hai điểm nhất định muốn ghé. Xếp lịch rồi chuyển Phở Bát Đàn xuống. Lượt ghé Phở Bát Đàn vượt cả 10:10 lẫn giờ đóng cửa mẫu.

## Lịch của tôi

Mỗi chuyến mới bắt đầu trống và có thể đổi tên ngay. Form, lịch nháp và thao tác hoàn tác được lưu theo chuyến trên trình duyệt. **Chốt lịch** tạo một bản riêng để xem lại. Sửa tiếp trong **Nháp** và bấm **Cập nhật lịch đã chốt** khi muốn thay bản đó.

Khi có dữ liệu hợp lệ từ phiên bản trước trên cùng trình duyệt và địa chỉ web, **Lịch của tôi** hiển thị một chuyến nháp tên **Chuyến đi đã lưu**. Khóa cũ `nonla-wander-v1` được giữ để có thể thử lại nếu lần ghi đầu thất bại.

## Dữ liệu và cách xếp

- Có 10 địa điểm mẫu quanh Hồ Gươm và Phố cổ. Tọa độ, thời lượng, chi phí, giờ mở cửa và độ đông là dữ liệu demo. Thời gian đi bộ chỉ tính giữa các điểm trong cùng buổi, từ khoảng cách ước tính theo tọa độ. Mỗi buổi bắt đầu tại điểm đầu tiên.
- Luật xếp ưu tiên các điểm nhất định muốn ghé, sau đó thêm lượt theo vibe, khu vực và quãng đi bộ. Mỗi điểm chỉ xuất hiện một lần trong chuyến. Các lượt được kiểm tra theo ngày mở cửa, toàn bộ thời lượng ghé, khung giờ và ngân sách cả lịch cho **một người**. Ứng dụng báo các buổi để trống hoặc còn nhiều thời gian chưa xếp được.
- Form và lịch lưu trong `localStorage` trên thiết bị. Có thể nhập yêu cầu riêng ở cả năm nhóm lựa chọn. Phần chữ tự do được lưu cùng form và thuật toán hiện dùng các lựa chọn có cấu trúc. Xe đạp và taxi có thể chọn trong form, còn máy xếp lịch hiện hỗ trợ tuyến đi bộ.
- `public/planner.js` lưu lịch theo buổi và lượt ghé với ID ổn định. Giờ, chi phí và cảnh báo được tính lại từ thứ tự lượt sau mỗi lệnh sửa. Mô hình `applyEdit(plan, command)` là điểm mở rộng cho kéo thả và lệnh như “Đổi quán cà phê chiều thứ Bảy”. Prototype dùng luật cục bộ, với bản đồ và tích hợp LLM hoặc Places nằm ngoài phạm vi bản đầu.

## Giao diện

Hệ thiết kế được ghi tại [design-system/nonla-wander/MASTER.md](design-system/nonla-wander/MASTER.md). Tranh minh họa [public/assets/ho-guom-xanh.webp](public/assets/ho-guom-xanh.webp) được tạo và chỉnh màu nước bằng ImageGen tích hợp. Yêu cầu ảnh là phong cảnh Hồ Gươm khổ ngang với Tháp Rùa, mặt nước phản chiếu và tán cây, theo nét khắc đồng trên giấy ngà màu nâu đỏ, có chút sắc ô liu, không có chữ hay khung trang trí.


<details>
<summary>Prompt tạo tranh và chỉnh màu nước</summary>

> Create a wide horizontal landscape editorial travel guide illustration of real Hoan Kiem Lake in Hanoi, Vietnam, architecture-faithful Thap Rua (Turtle Tower): small historic Vietnamese masonry three-tier tower with a narrow dark roof, arched doors, centered on a tiny low grassy island with its foot reflected in calm lake water. Leafy mature trees frame both edges, hazy tree-lined shore in distance. Style: richly detailed old Vietnamese printmaking copperplate etching on cream paper, fine ink crosshatching with slightly worn postcard grain, chocolate-sepia and brick-red ink with very restrained muted olive touches. Strong landscape composition and authentic architecture, evocative quiet early morning. Place the tower in the right-center (55% horizontal), and keep principal shapes in center vertical 50% for a panorama crop. Fill the entire frame with the landscape and ivory-toned sky. Asset only, no graphic frame, no stamps, no typography, lettering, numbers, text, border, UI, or watermarks. Wide 3:2 image suitable for cropping to 2.1:1.


> Edit the attached exact Hoan Kiem Lake editorial engraving, preserving the framing/aspect ratio and each detail. Change ONLY the chroma of the actual lake water in the lower portion of the picture (below the distant shoreline and around, never on, the tower’s grassy island, excluding foreground tree roots and foliage on either side). Give the water a gentle, muted natural blue with a subtle aqua/teal undertone, dialing down only its yellow-sepia cast. Use a restrained, pale gray-blue with a little green, as a subtle tint on a vintage hand-colored engraving. Keep the same luminance and contrast, preserve the original water-ripple engraving lines, paper texture and underwater tower, tree, and island reflections in their original shapes and brightness. Do not change any pixel visibly outside the actual water: original sepia sky, trees, distant bank, island, Thap Rua tower, foliage, and foreground roots remain exactly the source’s original brown/cream; preserve all original linework. No color spread into foreground plants or the island, no additional objects, no framing or typography, no cropping, no relighting. Authentic watercolor print touch of cool water balanced by unchanged warm paper above. Return the full image.

</details>
