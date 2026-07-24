# Zalo Agent Bridge

Bridge HTTP để backend Workshop Check-in quản lý `zalo-agent` mà không truy cập trực tiếp credential. Bridge sở hữu một tiến trình MCP HTTP lâu dài để giữ Zalo WebSocket hoạt động trên NAS.

```bash
export ZALO_BRIDGE_TOKEN='replace-with-a-long-random-token'
export ZALO_BRIDGE_HOST='127.0.0.1'
export ZALO_BRIDGE_PORT='18928'
export ZALO_MCP_PORT='18929'
export ZALO_MCP_TOKEN='replace-with-another-long-random-token'
npm start
```

Khi backend chạy trên NAS, chỉ expose bridge qua private network/VPN và đặt `ZALO_AGENT_BRIDGE_URL` của backend về địa chỉ private đó. Không public port bridge ra Internet.

Trong production, chỉ publish port MCP `18929` vào LAN/VPN. Port quản trị `18928` chỉ dùng trong Docker network. QR login, switch, logout và remove account được serialize; bridge tạm dừng MCP trước khi thay credential rồi khởi động lại để tránh duplicate Zalo Web session.

## Backend endpoints

Các endpoint yêu cầu `Authorization: Bearer <ZALO_BRIDGE_TOKEN>`. `account_owner_id` phải khớp tài khoản đang active. Lookup giới hạn 15 request/60 giây và gửi tin giới hạn 20 request/60 giây cho mỗi active account; response `429` có `Retry-After` và `retry_after_seconds`.

```json
POST /resolve-recipient
{"account_owner_id":"123456789","phone":"+84901234567"}

POST /messages
{"account_owner_id":"123456789","thread_id":"987654321","thread_type":0,"type":"text","text":"Xin chào"}

POST /messages
{"account_owner_id":"123456789","thread_id":"987654321","thread_type":0,"type":"image_album","paths":["/uploads/workshops/1/a.jpg"],"caption":"Ảnh workshop"}

POST /messages
{"account_owner_id":"123456789","thread_id":"987654321","thread_type":0,"type":"video","url":"https://cdn.example.com/video.mp4","thumbnail_url":"https://cdn.example.com/thumb.jpg","caption":"Video workshop","metadata":{"duration_ms":12000,"width":1280,"height":720}}
```

`thread_type` là `0` cho user và `1` cho group. Image album nhận 1-10 absolute paths, chỉ cho phép file có real path nằm trong `ZALO_UPLOAD_DIR` (mặc định `/uploads`). Request body mặc định tối đa 64 KiB, có thể chỉnh bằng `ZALO_BRIDGE_MAX_BODY_BYTES`. Hai endpoint mới luôn trả `request_id`; gửi thành công trả `sent: true` và raw CLI `result`.
