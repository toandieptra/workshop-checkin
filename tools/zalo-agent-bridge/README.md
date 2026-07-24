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
